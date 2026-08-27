# Ingesting a shadowing recording — runbook

You're being asked to ingest an audio recording into yutakanagoi's
shadowing-drill activity for a specific user. This file is the whole
runbook — you shouldn't need anything else re-explained. Read
`ingest/README.md` first if you want the command reference; this file is
the sequence and the judgment calls.

You'll need: the audio file's path, the username to ingest it for, and
optionally a supplied transcript file. If any of these is missing, ask
before starting.

**As of 3.1.0, this tool no longer cuts audio into chunks.** A whole
recording is the drill unit — one row in `shadowing_chunks` per recording,
not one per sentence. If you've done this before and remember a
plan-chunks/cut/grouping step, that no longer exists.

## The sequence, in order

1. `npm run ingest:transcribe -- --audio <file> --user <username> [--transcript <file>]`
2. **Proofread the transcript and fill `kana`/`translation`** in `ingest/work/<user>/<slug>/transcript.json`, for the whole recording.
3. `npm run ingest:publish -- --slug <slug> --user <username>`

Do all three steps in order, in this one session, without stopping to ask
permission between them — that's the point of driving this from a prompt
file instead of a person running each command by hand. Report back once
publish succeeds (or once you hit something you can't resolve yourself —
see "When something aborts" below).

**Exception: check what `.env` points at before step 3.** Every `ingest:*`
command reads `.env` by default (see `package.json`'s scripts) — steps 1-2
never write anywhere but your local working directory regardless of which
project that is, but step 3 (`ingest:publish`) is a real write to whatever
Supabase project `.env`'s `SUPABASE_URL` names. If that's the local stack
or staging, publish as part of this same uninterrupted run, same as every
other step. **If it's production, stop before running step 3 and get the
user's explicit confirmation first** — this is the same dry-run → staging
→ verify → confirm → production sequence CLAUDE.md requires for every
other production write in this repo; ingestion doesn't get a standing
exemption from it just because it's driven by a prompt file instead of a
person typing each command.

## Step 2: proofreading and enrichment

`ingest:transcribe` wrote `transcript.json` with `kana`/`translation`
already present as empty strings — your job is to fill them, and to
proofread `transcript`.

**Proofreading `transcript`** — do:

- Fix an occasional ASR typo or hallucinated word, and correct your own
  name if it's mangled (check for every phonetically-plausible mangling —
  a real batch had five different ones for the same name: デイリャン,
  ダイリャン, デーリャン, ディラン, ディリアン, all meaning the same
  ディリャン). This is a real transcription error, not a style edit —
  fixing it is exactly the kind of thing `--transcript`'s cross-check
  against whisper's own independent pass is designed to help you judge
  (see "When something aborts" below).
- Add `。！？、` where they belong, based on the natural sentence and
  clause breaks in the Japanese, for readability of the transcript hint
  shown in the drill. This is no longer required by any downstream
  step — there's no chunk-planner splitting on it — but it still makes
  the transcript easier to read as a hint.

Don't:

- Reword anything, correct grammar, or "clean up" disfluencies beyond
  fixing a genuine transcription error. Preserve false starts, repeated
  words, and filler exactly as spoken — the point of shadowing practice
  is how the person actually talks, not a polished version of it.
- Invent content that isn't there.

**Filling `kana` and `translation`** — for the whole recording (not
per-sentence):

- `kana` — the recording's Japanese text rendered entirely in kana
  (hiragana for native readings, katakana only where the source word is
  already katakana — e.g. loanwords, or a foreign-place-name reading
  convention like 北京 → ペキン). This is hint rung 2 in the drill's
  progressive hint ladder.
- `translation` — a natural English translation, conveying what was
  actually said including its register (casual speech reads as casual
  English, not textbook-formal). This is hint rung 3.

## When something aborts

Every command in this pipeline is designed to abort loudly rather than
proceed on bad data. Don't work around an abort by editing its way past
the check — fix the actual problem and re-run.

- **`ingest:transcribe` aborts on transcript divergence** (only when
  `--transcript` was given): it printed the supplied transcript's
  sentences that don't have a good match in whisper's independent pass.
  Read them. If the supplied transcript genuinely looks wrong (this is
  what catches a real ASR hallucination — an invented clause that was
  never actually said), fix the transcript file and re-run. If you're
  confident the supplied text is correct and whisper is what's wrong
  (whisper can mishear too — a mangled name, a dropped filler word),
  re-run with `--accept-transcript`. Don't add `--accept-transcript`
  reflexively just to get past the check — look at what it flagged
  first, and where possible corroborate against whisper's own segments
  (its raw per-segment text is right there in the divergence output).
- **`ingest:publish` aborts if `kana` or `translation` is still empty**:
  finish step 2 properly.

## A note on scope

This tool's only job is turning one audio file into a published recording.
It doesn't touch anything under `src/`, doesn't bump `package.json`'s
version, and doesn't need a CHANGELOG entry — see `ingest/README.md`'s
opening section. If the task at hand is something else (building the
drill UI, changing the DB schema, fixing a bug in `transcribe.ts` itself),
that's regular repo work, not an ingestion run — don't follow this runbook
for it.
