# Ingesting a shadowing recording — runbook

You're being asked to ingest an audio recording into yutakanagoi's
shadowing-drill activity for a specific user. This file is the whole
runbook — you shouldn't need anything else re-explained. Read
`ingest/README.md` first if you want the command reference; this file is
the sequence, the reasoning behind its order, and the judgment calls.

You'll need: the audio file's path, the username to ingest it for, and
optionally a supplied transcript file. If any of these is missing, ask
before starting.

## The sequence, in order

1. `npm run ingest:transcribe -- --audio <file> --user <username> [--transcript <file>]`
2. **Restore punctuation** in `ingest/work/<user>/<slug>/transcript.json`'s `transcript` field.
3. `npm run ingest:cut -- --slug <slug> --user <username>`
4. **Fill `kana` and `translation`** for every chunk in `ingest/work/<user>/<slug>/chunks.json`.
5. `npm run ingest:publish -- --slug <slug> --user <username>`

Do all five steps in order, in this one session, without stopping to ask
permission between them — that's the point of driving this from a prompt
file instead of a person running each command by hand. Report back once
publish succeeds (or once you hit something you can't resolve yourself —
see "When something aborts" below).

## Why the order is fixed

Step 2 must land before step 3: `ingest:cut`'s chunk planner aligns cut
boundaries on sentence-final marks (`。！？`) and clause commas (`、`) in
the transcript. Raw whisper output has none of these — cut against it
unpunctuated and you get one enormous, unusable chunk (the tool refuses to
proceed past this on its own, see below).

Step 4 must land after step 3, not before: kana and English translation
are per-_chunk_, and chunks don't exist until `ingest:cut` has decided
where the boundaries are. There's no way to translate "chunk 3" before
chunk 3 exists.

Don't try to collapse or reorder these — an agent that's seen a lot of
build pipelines might reflexively want to parallelize or "optimize" the
step order. There's nothing to optimize here; the dependency is real.

## Step 2: restoring punctuation

Read the raw `transcript` field in `transcript.json`. Add `。！？、` where
they belong, based on the natural sentence and clause breaks in the
Japanese. Do **not**:

- Reword anything, correct grammar, or "clean up" disfluencies. Preserve
  false starts, repeated words, and filler exactly as transcribed — the
  point of shadowing practice is how the person actually talks, not a
  polished version of it.
- Invent content that isn't there. If a stretch of text is ambiguous about
  where a sentence ends, use your best judgment on where a natural pause
  would fall, but don't add or remove words.

If `transcriptSource` is `"supplied"`, this step is a no-op — the supplied
transcript already went through `ingest:transcribe`'s cross-check gate and
has real punctuation. Skip straight to step 3.

## Step 4: filling kana and translation

For each chunk in `chunks.json`:

- `kana` — the chunk's Japanese text rendered entirely in kana (hiragana
  for native readings, katakana only where the source word is already
  katakana — e.g. loanwords). This is hint rung 2 in the drill's
  progressive hint ladder, shown to a learner who can't read the kanji.
- `translation` — a natural English translation of the chunk. Doesn't need
  to be word-for-word; it needs to convey what was actually said,
  including the register (casual speech should read as casual English,
  not textbook-formal).

Leave `verified` and `verifyFailures` alone — those are `ingest:cut`'s
output, not yours to edit.

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
  (whisper can mishear too), re-run with `--accept-transcript`. Don't add
  `--accept-transcript` reflexively just to get past the check — look at
  what it flagged first.
- **`ingest:cut` aborts if the transcript has no sentence-final
  punctuation** (ASR path only): you skipped or under-did step 2. Go back
  and restore punctuation properly.
- **`ingest:cut` aborts on a verification failure**: it printed which
  chunk(s) failed which check(s) (content match, attack, fades, distinct,
  coverage). `chunks.json` still gets written, with `verified: false` on
  the failing chunk(s), so you can inspect it — but don't hand-edit
  `verified` to `true` to force `ingest:publish` to accept it; that field
  exists specifically so a bad chunk can't slip through. A content-match
  or attack-check failure usually means the chunk boundaries chunk-planner
  chose are wrong for this audio — the most common actual fix is
  correcting the punctuation from step 2 (a missed sentence boundary,
  or a boundary placed somewhere the transcript doesn't support) and
  re-running `ingest:cut`. If chunks keep failing verification for reasons
  that don't trace back to the transcript, stop and report it rather than
  guessing further — this may be a real bug in the pipeline, worth
  surfacing rather than working around.
- **`ingest:publish` aborts if any chunk isn't fully enriched or verified
  clean**: it names which chunks and which field. Finish step 4 properly,
  or re-run `ingest:cut` if a chunk's `verified` is still false.

## A note on scope

This tool's only job is turning one audio file into published chunks. It
doesn't touch anything under `src/`, doesn't bump `package.json`'s
version, and doesn't need a CHANGELOG entry — see `ingest/README.md`'s
opening section. If the task at hand is something else (building the
drill UI, changing the DB schema, fixing a bug in `chunk-planner.ts`
itself), that's regular repo work, not an ingestion run — don't follow
this runbook for it.
