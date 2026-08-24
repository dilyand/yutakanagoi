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
2. **Restore punctuation and fix small transcription errors** in `ingest/work/<user>/<slug>/transcript.json`'s `transcript` field.
3. `npm run ingest:plan-chunks -- --slug <slug> --user <username>`
4. **Group the resulting units into chunks by meaning, and fill `kana`/`translation`** for each final chunk in `ingest/work/<user>/<slug>/chunk_plan.json`.
5. `npm run ingest:cut -- --slug <slug> --user <username>`
6. `npm run ingest:publish -- --slug <slug> --user <username>`

Do all six steps in order, in this one session, without stopping to ask
permission between them — that's the point of driving this from a prompt
file instead of a person running each command by hand. Report back once
publish succeeds (or once you hit something you can't resolve yourself —
see "When something aborts" below).

**Exception: check what `.env` points at before step 6.** Every `ingest:*`
command reads `.env` by default (see `package.json`'s scripts) — steps 1-5
never write anywhere but your local working directory regardless of which
project that is, but step 6 (`ingest:publish`) is a real write to whatever
Supabase project `.env`'s `SUPABASE_URL` names. If that's the local stack
or staging, publish as part of this same uninterrupted run, same as every
other step. **If it's production, stop before running step 6 and get the
user's explicit confirmation first** — this is the same dry-run → staging
→ verify → confirm → production sequence CLAUDE.md requires for every
other production write in this repo; ingestion doesn't get a standing
exemption from it just because it's driven by a prompt file instead of a
person typing each command.

## Why the order is fixed, and why grouping happens separately from cutting

Step 2 must land before step 3: `ingest:plan-chunks` splits the transcript
on sentence-final marks (`。！？、`'s big siblings — `、` only matters
starting step 4). Raw whisper output has none of these — splitting
against it unpunctuated produces one giant, meaningless unit.

Step 4 must land after step 3, not before: `ingest:plan-chunks` writes
`chunk_plan.json`'s scaffold — one entry per atomic sentence unit, no
grouping decided yet. There's nothing to group until that scaffold
exists.

Step 5 (cutting) is **mechanical and audio-only** — it does not decide
which sentences belong together. That decision already happened in step
4, by someone (you) actually reading the transcript for meaning.
`ingest:cut` only answers "where, precisely, does this already-decided
chunk of text live in the audio, and is there a real quiet point there to
cut cleanly." This split exists on purpose: an earlier, fully-automatic
version of this pipeline tried to decide grouping and audio-cutting in
one pass, gated on whether a candidate boundary happened to land near a
detected pause — which conflated "do these sentences belong together"
with "is there a pause here," and produced groupings that looked
arbitrary because they effectively were. Deciding grouping from meaning
first, then locating it in the audio second, is what actually fixes that.

Don't try to collapse or reorder these — an agent that's seen a lot of
build pipelines might reflexively want to parallelize or "optimize" the
step order. There's nothing to optimize here; the dependency is real.

## Step 2: restoring punctuation and fixing small transcription errors

Read the raw `transcript` field in `transcript.json`. You're aiming for a
transcript you'd trust completely: sentence ends clearly marked (`。！？`),
and logical splits inside longer sentences marked with `、` wherever a
natural clause break exists — regardless of whether a real audio pause
sits there or not (that's what makes those splits usable as chunk
candidates in step 4; step 5's audio-location step is what checks whether
a real pause backs them up).

Do:

- Fix an occasional ASR typo or hallucinated word, and correct your own
  name if it's mangled (check for every phonetically-plausible mangling —
  a real batch had five different ones for the same name: デイリャン,
  ダイリャン, デーリャン, ディラン, ディリアン, all meaning the same
  ディリャン). This is a real transcription error, not a style edit —
  fixing it is exactly the kind of thing `--transcript`'s cross-check
  against whisper's own independent pass is designed to help you judge
  (see "When something aborts" below).
- Add `。！？、` where they belong, based on the natural sentence and
  clause breaks in the Japanese.

Don't:

- Reword anything, correct grammar, or "clean up" disfluencies beyond
  fixing a genuine transcription error. Preserve false starts, repeated
  words, and filler exactly as spoken — the point of shadowing practice
  is how the person actually talks, not a polished version of it.
- Invent content that isn't there. If a stretch of text is ambiguous about
  where a sentence ends, use your best judgment on where a natural pause
  would fall, but don't add or remove words.

Check the actual `transcript` field for sentence-final marks (`。！？`),
regardless of `transcriptSource` — `ingest:transcribe`'s cross-check gate
only compares supplied text against whisper's own pass for divergence, it
never validates or requires punctuation, so a supplied transcript can
arrive just as unpunctuated as raw ASR output. If it already has real
punctuation, this step is mostly a proofread — skim it for the errors
above and move on.

## Step 4: grouping into chunks and filling kana/translation

`ingest:plan-chunks` wrote `chunk_plan.json` as a scaffold: one entry per
atomic sentence unit (`{ "text": ..., "kana": "", "translation": "" }`),
in transcript order. Your job:

- **Group.** Read through in order. Where a unit is too short to stand
  alone as a shadowing chunk, or belongs with its neighbor by meaning
  (not by duration target — there's no target anymore), merge it: replace
  the two adjacent entries with one whose `text` is their concatenation,
  and delete the entry you merged away. Keep doing this until every
  remaining entry reads as a sensible, self-contained chunk. This is a
  judgment call about meaning, the same kind you're already making when
  you write a translation for a chunk — there's no mechanical rule to
  fall back on.
- **Enrich.** For each final (post-grouping) entry, fill:
  - `kana` — the chunk's Japanese text rendered entirely in kana
    (hiragana for native readings, katakana only where the source word is
    already katakana — e.g. loanwords, or a foreign-place-name reading
    convention like 北京 → ペキン).
  - `translation` — a natural English translation, conveying what was
    actually said including its register (casual speech reads as casual
    English, not textbook-formal).

Every entry's `text` must stay an untrimmed substring of the transcript, up
to width-normalization (half-width `?`/`!`/`.`/`,` are equivalent to their
full-width forms here, same as everywhere else in this pipeline — see
`chunk-planner.ts`'s `normalizeMarkWidth`) — `ingest:cut` verifies every
entry concatenates back to `transcript.json`'s `transcript` field under
that same normalization, and aborts if it doesn't (catches an accidental
edit, reorder, or dropped text during grouping, not just a missed merge).

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
- **`ingest:plan-chunks` aborts if the transcript has no sentence-final
  punctuation**: you skipped or under-did step 2. Go back and restore
  punctuation properly.
- **`ingest:plan-chunks` refuses to overwrite an existing
  `chunk_plan.json`**: if you genuinely want to regenerate the scaffold
  from scratch (e.g. you fixed something in `transcript.json` after
  already starting to group), remove `chunk_plan.json` by hand first —
  this is a deliberate guard against silently destroying grouping/kana/
  translation work already done.
- **`ingest:cut` aborts if `chunk_plan.json` still has an empty `kana` or
  `translation`**: finish step 4 properly.
- **`ingest:cut` aborts if the planned texts don't reconstruct the
  transcript exactly**: a grouping edit dropped, duplicated, or reworded
  some text. Fix `chunk_plan.json` so its entries concatenate back to
  `transcript.json`'s `transcript` field word-for-word.
- **`ingest:cut` aborts if a planned boundary can't find a real pause
  nearby in the audio**: this is the one case that's about the audio, not
  the grouping decision itself — it means two chunks you decided should
  be separate don't actually have a gap between them in the recording
  (continuous, run-together speech). The fix is almost always to merge
  those two chunks in `chunk_plan.json` and re-run — forcing a cut with
  nothing real to anchor it to isn't an option (verify.ts's attack check
  would just fail on it anyway).
- **`ingest:cut` aborts on a verification failure** after chunks were
  successfully located: it printed which chunk(s) failed which check(s)
  (content match, attack, fades, distinct, coverage). `chunks.json` still
  gets written, with `verified: false` on the failing chunk(s), so you
  can inspect it — but don't hand-edit `verified` to `true` to force
  `ingest:publish` to accept it. This traces to the actual audio cut, not
  the grouping (which already located cleanly to get this far) — if it
  keeps failing for reasons that don't make sense, stop and report it
  rather than guessing further; this may be a real bug in the pipeline,
  worth surfacing rather than working around.
- **`ingest:publish` aborts if any chunk isn't fully enriched or verified
  clean**: by this point that should already be impossible (step 4 and
  `ingest:cut` both check it earlier), but if it happens anyway, re-run
  `ingest:cut` rather than hand-editing `chunks.json`.

## A note on scope

This tool's only job is turning one audio file into published chunks. It
doesn't touch anything under `src/`, doesn't bump `package.json`'s
version, and doesn't need a CHANGELOG entry — see `ingest/README.md`'s
opening section. If the task at hand is something else (building the
drill UI, changing the DB schema, fixing a bug in `chunk-planner.ts`
itself), that's regular repo work, not an ingestion run — don't follow
this runbook for it.
