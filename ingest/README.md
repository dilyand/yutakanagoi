# Shadowing clip processor

A local command-line tool that turns an audio recording into a verified,
transcribed, translated shadowing-drill item in yutakanagoi's database.

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

## No audio chunking

As of 3.1.0, this tool no longer cuts a recording into sentence-level
chunks. Earlier versions ran a transcript-guided chunk-planner (sentence
splitting, silence-anchored boundary location, per-chunk fades and
verification) so a session drilled one sentence at a time. That pipeline
consistently cost more time to tend (boundary tuning, re-cuts, manual
listening review) than it saved in drill granularity, so it's gone
entirely — **a whole recording is now the drill unit**. A recording still
publishes as exactly one `shadowing_chunks` row; progress is tracked per
recording rather than per sentence.

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

The core ingestion sequence is two commands (`transcribe`, `publish`) plus
one manual enrichment step in between — `flagged` and
`cleanup-old-versions` are separate, occasional maintenance commands, not
part of the sequence. The sequence is designed to be run as **one Claude
Code session**, driven by `PROMPT.md`:

> "Use the prompt from ingest to ingest `~/Downloads/some-recording.m4a`
> for dilyand."

That one message is enough — `PROMPT.md` carries the sequence, the
enrichment rules, and what to do if a step aborts, so nothing has to be
re-explained per run. The rest of this section documents the commands
directly, for running by hand or understanding what the session is doing.

```sh
npm run ingest:transcribe          -- --audio <file> --user <username> [--transcript <file>] [--accept-transcript]
npm run ingest:publish             -- --slug <slug> --user <username> [--dry-run]
npm run ingest:flagged             -- --user <username>
npm run ingest:cleanup-old-versions -- --slug <slug> --user <username> [--dry-run]
```

Working files land in `ingest/work/<user>/<slug>/` (gitignored — local
scratch space, not committed).

### 1. `ingest:transcribe`

Converts the audio to a 16k mono analysis wav, transcribes it with
whisper, and writes `transcript.json` with `kana`/`translation` left
blank.

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

Re-running this for a slug that already has enrichment work done
overwrites `transcript.json` wholesale, resetting `kana`/`translation` to
blank — that's deliberate: new/replacement audio genuinely needs fresh
enrichment, so there's nothing else to invalidate.

### 2. Proofread and enrich (manual/agent step)

Edit `transcript.json` directly:

- **Proofread the `transcript` field** — fix an occasional ASR typo,
  hallucinated word, or mangled name. Adding `。！？、` for readability is
  worthwhile but no longer required by anything downstream — there's no
  chunk-planner splitting on it anymore. Preserve disfluencies, false
  starts, and repeated words as spoken; don't reword beyond fixing a
  genuine transcription error.
- **Fill `kana`** — a kana-only rendering of the whole recording's
  Japanese text (hint rung 2 in the drill's hint ladder).
- **Fill `translation`** — a natural English translation of the whole
  recording (hint rung 3).

### 3. `ingest:publish`

Checks `kana`/`translation` are both filled in, then uploads the source
audio to the `shadowing-audio` Storage bucket and inserts/updates the DB
rows. Use `--dry-run` to see what it would do without touching anything.

A recording publishes as exactly **one** `shadowing_chunks` row — its
`audio_path` points at the same uploaded file as the recording's own
`source_audio_path`, since there's no separate cut/faded copy anymore.

**Re-publishing an already-published `(user, slug)`** bumps
`chunking_version` (kept as the column name even though nothing is
"chunked" anymore — renaming it would need a migration this no-schema-
break pivot deliberately avoids) and replaces that recording's one chunk
row (atomically — see `supabase/README.md`'s
"`publish_shadowing_recording`" section), orphaning progress on the old
version's chunk id (see `supabase/README.md`'s "Shadowing tables" section
for why this is accepted rather than migrated). The source is uploaded
under a `v<chunking_version>/` prefix, so a re-publish's upload can never
touch anything the currently-live version depends on — the old version's
DB rows are replaced only once the new file is safely uploaded.

The old version's Storage object is deliberately **not** deleted by this
command — a client that started a session before the re-publish may still
hold a signed URL into that old audio (valid up to 2h). See
`ingest:cleanup-old-versions` below.

### `ingest:flagged`

Lists a user's chunks flagged in-app (via the drill's Flag button) —
recording, storage path, transcript, offsets, note. The companion to
debugging a bad recording: "let's debug flagged items" starts here, since
acting on a flag means re-ingesting, which is this tool's job.

### `ingest:cleanup-old-versions`

Removes Storage objects for every `chunking_version` of a recording older
than the currently live one. Deliberately a separate, manually-run command
rather than something `ingest:publish` does automatically — run it once
you're confident no session from before the re-publish is still active
(past the 2h signed-URL TTL is a safe rule of thumb). `--dry-run` previews
what would be removed.

## Files

| File                 | What it is                                                                |
| -------------------- | ------------------------------------------------------------------------- |
| `audio-tools.ts`     | ffmpeg/ffprobe primitives — analysis-wav conversion and duration probing. |
| `transcribe.ts`      | whisper-cli wrapper.                                                      |
| `transcript-diff.ts` | The supplied-vs-ASR cross-check gate.                                     |
| `args.ts`            | Minimal `--flag value` argv parsing, no dependency.                       |
| `cli/*.ts`           | The four command entry points (`npm run ingest:*`).                       |

The `cli/*.ts` commands reuse `src/lib/list-naming.ts`'s `deriveListName`
for slug derivation and `scripts/lib/supabase-admin.ts`'s
`createAdminClient` for DB access — both already-generic app utilities, not
shadowing-specific business logic, so reusing them here doesn't blur the
"not part of the app" boundary.
