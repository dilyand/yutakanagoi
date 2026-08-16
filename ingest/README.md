# Shadowing clip processor

A local command-line tool that turns an audio recording into verified,
transcribed, translated chunks in yutakanagoi's database, for the
shadowing-drill activity.

**This is not part of the yutakanagoi app.** It never gets deployed, it
doesn't affect `package.json`'s version, and changes here don't get a
CHANGELOG entry — see the repo root `CLAUDE.md`'s "Ingest tool" note. The
only thing it shares with the app is the DB schema
(`supabase/migrations/20260814000001_shadowing_tables.sql`) and the
`shadowing-audio` Storage bucket it writes to.

## Why a local tool, not an in-app upload

Transcription needs [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
(a ~1.5GB local model) and [ffmpeg](https://ffmpeg.org/), and Claude has no
audio input. Running either inside a Vercel serverless function isn't
practical, and standing up a hosted ASR vendor plus a background worker
just for this would be a new architectural piece for a project that's
deliberately stayed on Supabase + Vercel + Anthropic. So: a laptop tool.
In-app upload is a possible later addition (an endpoint that stores raw
audio as `pending`, plus a `--pending` mode here) — nothing in this design
would need undoing to add it.

## Prerequisites

```sh
brew install ffmpeg whisper-cpp
```

Download a whisper model (large-v3-turbo recommended — good accuracy for
Japanese transcription at roughly 8x the speed of full large-v3):

```sh
mkdir -p ~/whisper-models
curl -L -o ~/whisper-models/ggml-large-v3-turbo.bin \
  https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin
```

If the model lives somewhere else, set `WHISPER_MODEL_PATH` before running
any command.

You'll also need `.env` populated with `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` for whichever project you're publishing to —
same file the rest of the repo's scripts use (see the root `.env.example`).
**Publishing writes to a real project** — point `.env` at your local stack
(`npx supabase start`) or staging while testing; only point it at
production once you're confident (see "Production data changes" in the
root `CLAUDE.md`).

## Usage

The tool is four commands plus two manual editing steps in between. The
whole sequence — including the editing steps — is designed to be run as
**one Claude Code session**, driven by `PROMPT.md`:

> "Use the prompt from ingest to ingest `~/Downloads/some-recording.m4a`
> for dilyand."

That one message is enough — `PROMPT.md` carries the sequence, the reasons
for its ordering, the editing rules, and what to do if a step aborts, so
nothing has to be re-explained per run. The rest of this section documents
the commands directly, for running by hand or understanding what the
session is doing.

```sh
npm run ingest:transcribe -- --audio <file> --user <username> [--transcript <file>] [--accept-transcript]
npm run ingest:cut        -- --slug <slug> --user <username>
npm run ingest:publish    -- --slug <slug> --user <username> [--dry-run]
npm run ingest:flagged    -- --user <username>
```

Working files land in `ingest/work/<user>/<slug>/` (gitignored — local
scratch space, not committed).

### 1. `ingest:transcribe`

Converts the audio to a 16k mono analysis wav, transcribes it with
whisper, and writes `transcript.json`.

- **With `--transcript <file>`**: cross-checks the supplied text against
  whisper's own independent pass (this is what catches a genuine ASR
  hallucination — see the design notes). Diverges too much → aborts,
  printing every divergent sentence, unless `--accept-transcript` is also
  passed. `transcript.json`'s `transcript` field is set to your supplied
  text.
- **Without**: whisper's raw output becomes the transcript — unpunctuated,
  in whisper's usual style. There's nothing to cross-check it against, so
  the safety net for a bad transcript here is the in-app Flag button, not
  this step.

### 2. Restore punctuation (manual/agent step)

Edit `transcript.json`'s `transcript` field to add sentence-final marks
(`。！？`) and clause commas (`、`). **Required on the ASR path** — the next
step's chunk planner aligns cuts on exactly those marks, so an unpunctuated
transcript produces one giant, unusably long chunk (and `ingest:cut`
refuses to proceed past that). A no-op on the supplied-transcript path,
since real punctuation is already there.

Preserve disfluencies, false starts, and repeated words as spoken — the
point of shadowing practice is how someone actually talks, not a
cleaned-up version of it. Don't reword.

### 3. `ingest:cut`

Plans chunk boundaries (transcript-guided, automatic — see
`chunk-planner.ts`'s header comment for the algorithm and its known
limits), cuts and fades every chunk, and verifies each one — content
match against the source, no cut landing on a consonant attack, fades
actually applied, every chunk distinct, full coverage of the recording.
**Any verification failure aborts** — `chunks.json` is still written (for
inspection), but with `verified: false` on the failing chunk(s), and
`ingest:publish` refuses to run until every chunk shows clean.

Writes `chunks.json` with `kana`/`translation` left blank per chunk.

### 4. Fill kana and translation (manual/agent step)

For each chunk in `chunks.json`, fill in:

- `kana` — a kana-only rendering of the chunk's Japanese text (hint rung 2
  in the drill's hint ladder).
- `translation` — an English translation (hint rung 3).

### 5. `ingest:publish`

Checks every chunk verified clean and has non-empty `kana`/`translation`,
then uploads audio to the `shadowing-audio` Storage bucket and
inserts/updates the DB rows. Use `--dry-run` to see what it would do
without touching anything.

**Re-publishing an already-published `(user, slug)` is a re-chunk**: it
bumps `chunking_version`, replaces that recording's `shadowing_chunks`
rows entirely, and orphans progress on the old version's chunk ids (see
`supabase/README.md`'s "Shadowing tables" section for why this is
accepted rather than migrated). The full source recording is kept in
Storage specifically so a re-chunk never requires re-recording.

### `ingest:flagged`

Lists a user's chunks flagged in-app (via the drill's Flag button) —
recording, storage path, transcript, offsets, note. The companion to
debugging a bad chunk: "let's debug flagged items" starts here, since
acting on a flag means re-cutting, which is this tool's job.

## Files

| File                 | What it is                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `chunk-planner.ts`   | Pure, unit-tested boundary-selection logic. No I/O.                                         |
| `audio-tools.ts`     | ffmpeg/ffprobe primitives — one function per real gotcha found during the feasibility work. |
| `transcribe.ts`      | whisper-cli wrapper.                                                                        |
| `transcript-diff.ts` | The supplied-vs-ASR cross-check gate.                                                       |
| `verify.ts`          | The five per-chunk/per-recording verification checks.                                       |
| `args.ts`            | Minimal `--flag value` argv parsing, no dependency.                                         |
| `cli/*.ts`           | The four command entry points (`npm run ingest:*`).                                         |

The `cli/*.ts` commands reuse `src/lib/list-naming.ts`'s `deriveListName`
for slug derivation and `scripts/lib/supabase-admin.ts`'s
`createAdminClient` for DB access — both already-generic app utilities, not
shadowing-specific business logic, so reusing them here doesn't blur the
"not part of the app" boundary.
