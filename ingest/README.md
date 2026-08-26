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

The core ingestion sequence is four commands (`transcribe`, `plan-chunks`,
`cut`, `publish`) plus two manual editing steps in between — `flagged` and
`cleanup-old-versions` are separate, occasional maintenance commands, not
part of the sequence. The sequence — including the editing steps — is
designed to be run as **one Claude Code session**, driven by `PROMPT.md`:

> "Use the prompt from ingest to ingest `~/Downloads/some-recording.m4a`
> for dilyand."

That one message is enough — `PROMPT.md` carries the sequence, the reasons
for its ordering, the editing rules, and what to do if a step aborts, so
nothing has to be re-explained per run. The rest of this section documents
the commands directly, for running by hand or understanding what the
session is doing.

```sh
npm run ingest:transcribe          -- --audio <file> --user <username> [--transcript <file>] [--accept-transcript]
npm run ingest:plan-chunks         -- --slug <slug> --user <username>
npm run ingest:cut                 -- --slug <slug> --user <username>
npm run ingest:publish             -- --slug <slug> --user <username> [--dry-run]
npm run ingest:flagged             -- --user <username>
npm run ingest:cleanup-old-versions -- --slug <slug> --user <username> [--dry-run]
```

Working files land in `ingest/work/<user>/<slug>/` (gitignored — local
scratch space, not committed).

### 1. `ingest:transcribe`

Converts the audio to a 16k mono analysis wav, transcribes it with
whisper twice, and writes `transcript.json`. The first pass produces the
usual multi-sentence `whisperSegments` (readable, used as a fallback);
the second, with `-ml 1`, produces `charTimings` — real per-character DTW
alignment against the audio, which is what `ingest:cut` later uses to
locate a decided chunk boundary precisely rather than estimating it off
coarse segment timing. Roughly doubles this step's running time.

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

### 2. Restore punctuation and fix small errors (manual/agent step)

Edit `transcript.json`'s `transcript` field to add sentence-final marks
(`。！？`) and clause commas (`、`), and fix an occasional ASR typo,
hallucinated word, or mangled name. **Punctuation is required whenever the
transcript lacks sentence-final marks** — the next step splits purely on
those marks, so an unpunctuated transcript produces one giant, meaningless
unit, and `ingest:plan-chunks` refuses to proceed past that regardless of
`transcriptSource`. Not necessarily a no-op on the supplied-transcript
path: `ingest:transcribe --transcript` only trims the supplied text and
cross-checks it against whisper's own pass for divergence — it never
validates or requires punctuation, so a supplied transcript can arrive
just as unpunctuated as raw ASR output. If it already has real
punctuation, this is mostly a proofread — check the actual text rather
than assuming from the source.

Preserve disfluencies, false starts, and repeated words as spoken — the
point of shadowing practice is how someone actually talks, not a
cleaned-up version of it. Don't reword beyond fixing a genuine
transcription error.

### 3. `ingest:plan-chunks`

Mechanical scaffold step — splits `transcript.json`'s transcript purely on
sentence-final marks (`splitIntoSentenceUnits` in `chunk-planner.ts`, no
audio input at all) and writes `chunk_plan.json`: one entry per atomic
unit, `kana`/`translation` blank. Refuses to overwrite an existing
`chunk_plan.json` — remove it by hand first if you actually want to
regenerate from scratch (a guard against silently destroying grouping/
enrichment work already done).

### 4. Group into chunks and fill kana/translation (manual/agent step)

This is where grouping actually gets decided — by meaning, not by an
algorithm. For each entry in `chunk_plan.json`, in order: merge it into a
neighbor (concatenate `text`, delete the merged-away entry) if it's too
short to stand alone or belongs with that neighbor by meaning, until every
remaining entry reads as a sensible, self-contained chunk. The reverse
also applies: `ingest:plan-chunks` only scaffolds sentence-final-mark
units, so a long sentence with internal clause commas arrives as one
entry — split it into two adjacent entries (whose `text` still
concatenates back exactly) at whichever `、` reads best if it should be
two chunks; `ingest:cut` locates a split entry the same as any other
boundary and tells you if there's no real pause to cut it on. Then fill,
for each final entry:

- `kana` — a kana-only rendering of the chunk's Japanese text (hint rung 2
  in the drill's hint ladder).
- `translation` — an English translation (hint rung 3).

Every entry's `text` must stay a substring of the transcript, up to
width-normalization — `ingest:cut` width-normalizes both sides (the same
`normalizeMarkWidth` step splitting already applied — see `chunk-planner.ts`)
before checking the full set concatenates back to `transcript.json`, and
aborts if it doesn't. A half-width mark you left un-normalized by hand is
fine; dropped, reordered, or reworded content is what actually fails this.

### 5. `ingest:cut`

Purely mechanical from here — no grouping decisions. Locates each
`chunk_plan.json` entry in the real audio (`locateChunks` in
`chunk-planner.ts`: estimates each boundary's time via the char-timing DTW
spine, requires a real nearby silence window to cut on, trims with the
same pre-attack/tail buffers as before), cuts and fades every chunk, and
verifies each one — content match against the source, no cut landing on a
consonant attack, fades actually applied, every chunk distinct, full
coverage of the recording. **A boundary with no real pause nearby aborts
before any cutting happens** — the fix is to merge those two chunks in
`chunk_plan.json`, not to force a cut with nothing to anchor it to.
**Any verification failure aborts** too — `chunks.json` is still written
(for inspection), with `verified: false` on the failing per-chunk check(s)
and any recording-wide failure (distinctness, coverage) listed in
`chunks.json`'s `recordingVerifyFailures`. `ingest:publish` refuses to run
until every chunk shows clean **and** `recordingVerifyFailures` is empty.

Writes `chunks.json` with `kana`/`translation` copied straight from
`chunk_plan.json` — already filled by step 4, not left blank.

### 6. `ingest:publish`

Checks every chunk verified clean and has non-empty `kana`/`translation`,
then uploads audio to the `shadowing-audio` Storage bucket and
inserts/updates the DB rows. Use `--dry-run` to see what it would do
without touching anything.

**Re-publishing an already-published `(user, slug)` is a re-chunk**: it
bumps `chunking_version`, replaces that recording's `shadowing_chunks`
rows entirely (atomically — see `supabase/README.md`'s
"`publish_shadowing_recording`" section), and orphans progress on the old
version's chunk ids (see `supabase/README.md`'s "Shadowing tables" section
for why this is accepted rather than migrated). The source recording and
every chunk are uploaded under a `v<chunking_version>/` prefix — including
the source, so a re-publish's uploads can never touch anything the
currently-live version depends on — and the old version's DB rows are
replaced only once every new file is safely uploaded.

The old version's Storage objects are deliberately **not** deleted by this
command — a client that started a session before the re-publish may still
hold a signed URL into that old audio (valid up to 2h). See
`ingest:cleanup-old-versions` below.

### `ingest:flagged`

Lists a user's chunks flagged in-app (via the drill's Flag button) —
recording, storage path, transcript, offsets, note. The companion to
debugging a bad chunk: "let's debug flagged items" starts here, since
acting on a flag means re-cutting, which is this tool's job.

### `ingest:cleanup-old-versions`

Removes Storage objects for every `chunking_version` of a recording older
than the currently live one. Deliberately a separate, manually-run command
rather than something `ingest:publish` does automatically — run it once
you're confident no session from before the re-publish is still active
(past the 2h signed-URL TTL is a safe rule of thumb). `--dry-run` previews
what would be removed.

## Files

| File                 | What it is                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `chunk-planner.ts`   | Pure, unit-tested text/audio-alignment logic, split in two: `splitIntoSentenceUnits` (text only) and `locateChunks` (audio only). No I/O. |
| `audio-tools.ts`     | ffmpeg/ffprobe primitives — one function per real gotcha found during the feasibility work.                                               |
| `transcribe.ts`      | whisper-cli wrapper — `transcribeWav` (coarse segments) and `transcribeWavCharTimings` (per-character DTW via `-ml 1`).                   |
| `transcript-diff.ts` | The supplied-vs-ASR cross-check gate.                                                                                                     |
| `verify.ts`          | The five per-chunk/per-recording verification checks.                                                                                     |
| `args.ts`            | Minimal `--flag value` argv parsing, no dependency.                                                                                       |
| `cli/*.ts`           | The six command entry points (`npm run ingest:*`).                                                                                        |

The `cli/*.ts` commands reuse `src/lib/list-naming.ts`'s `deriveListName`
for slug derivation and `scripts/lib/supabase-admin.ts`'s
`createAdminClient` for DB access — both already-generic app utilities, not
shadowing-specific business logic, so reusing them here doesn't blur the
"not part of the app" boundary.
