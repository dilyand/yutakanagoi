# Changelog

For what belongs here vs. `CLAUDE.md` vs. Claude Code's local memory, see
CLAUDE.md's "Keeping this doc useful" section. Short version: this file
records what shipped and why, briefly — current behavior lives in
`CLAUDE.md`, deep session-specific detail lives in memory.

## 2.1.0 — AnkiApp deck import for vocab drill lists

Word list uploads previously only accepted one-word-per-line `.txt`/`.md`
files; importing a deck exported from AnkiApp (a flashcard app) meant
manually converting its XML export first — done once, by hand, for the
`hellotalk-words` list. Now permanent: uploading a `.xml` file runs it
through `parseAnkiAppDeck()` (`src/lib/ankiapp-deck-parser.ts`), which reads
each card's `<japanese>` field via the browser's native `DOMParser` and
discards the `Meaning` field (meanings always come from Claude at drill
time, never from the source list). Parsing stays entirely client-side, so
`/api/lists/upload` and its schema are unchanged — both `.txt`/`.md` and
`.xml` uploads converge on the same `words: string[]` shape, and the
database has no record of which format a list originated from.

Also normalized list naming: names are now kebab-cased from the uploaded
filename (`HelloTalk.xml` → `hello-talk`), not just extension-stripped —
applies to all uploads, not only `.xml` ones. No production backfill
needed, since existing list names were already lowercase-hyphenated by
coincidence of how they were originally typed.

Also fixed a pre-existing gap in the update-conflict flow surfaced while
verifying this release on a Preview deployment: confirming an update
(`ListSelector.svelte`'s `confirmUpdate`) navigated straight into the list
with no indication of how many words were actually added, so a merge that
silently added 0 words looked identical to one that added several. Now
shows an explicit "Added N words" / "already up to date" message with a
"Continue" button before proceeding.

## 2.0.3 — support updating an existing word list

Third of the cleanup patch series (issue #28). Re-uploading a filename that
matched an existing list used to be rejected outright (409), to protect
that list's Leitner progress — but that also blocked the common case of
re-uploading a maintained frequency list that's grown since it was first
uploaded. Added `updateWordList` (`user-list-repository.ts`): additive
only, new words are appended past the list's current max `frequency_rank`,
existing words/progress are never touched, removal/reordering are
out of scope. The upload endpoint takes an `update` flag to opt into this
path; the UI surfaces the previous silent 409 as an explicit "update this
list instead?" confirmation (`ListSelector.svelte`) rather than silently
upserting, so a wrong-file re-upload can still be caught before it merges.

Also stripped the file extension from list names — it's an artifact of the
upload mechanism (nothing is ever stored as a file; the browser parses it
client-side into a word array), not part of a list's identity, and would
only get more misleading once other file types are supported. Stripped
client-side for new uploads/updates; `scripts/strip-list-name-extensions.ts`
backfilled the 3 existing rows on staging and production.

## 2.0.2 — conjugation word list cleanup + downsizing

Second of the cleanup patch series. `conjugation-word-list.ts` inherited the
same data-quality problems 2.0.1 fixed in the master vocab list (it was
generated from the pre-cleanup version of that file) — cross-referencing
confirmed 96 of 2.0.1's 130 changed words were still present here, 42 of
them actively drillable. Fixed those, plus a handful of additional
kana/kanji duplicate pairs of the same lexeme found during this pass
(ゆく/行く, 訊く/聞く, 気がつく/気づく, ほしい/欲しい, やってくる/やって来る)
and one colloquial contraction masquerading as a dictionary verb (ちまう).

At the same time, reshaped the list from "full frequency-ranked pool with a
down-sample flag" (593 of 1697 words drillable) to a small, deliberately
curated set per word class (320 words total): top ~30 per verb class plus
a guaranteed-inclusion set of canonical textbook verbs/adjectives that a
pure frequency cutoff would otherwise exclude (e.g. 食べる, 寝る, 起きる),
30 new suru-compound entries built from scratch (the file previously had
only する itself), copula kept exactly at its existing 30 hand-picked
な-adjectives (verified all still correct, no expansion), kuru deduplicated
to 2 entries. The now-fully-vestigial `included` field (down-sampling no
longer happens at this layer) was dropped from the type, `pickWordForCell`,
and the tests. Deleted `scripts/classify-conjugation-words.ts` (called the
metered Anthropic API for classification — this pass used Claude Code
subagents directly instead, never the API) since its output shape no
longer matches the new schema. No DB migration needed — confirmed via
`supabase/README.md`'s conjugation-tables section — progress is keyed on
`(word_class, form_id)` cells, never on word text.

## 2.0.1 — master word list data-quality cleanup

First of a planned series of patch releases working through existing open
issues/tech debt before starting a third activity. Closes #25:
`japanese-2000-most-frequent-words.md` had 130 corrupt/duplicate/archaic
entries removed and 2 replaced with their standard spelling (2000 → 1870
words), via three rounds of parallel Claude Code subagent classification
plus independent verification. Categories: corrupt/truncated fragments,
bare kana on'yomi readings that are never standalone words, nonstandard
okurigana, kana/kanji duplicate pairs of a word already listed elsewhere,
and one obscure personal name. Removed the dead `KNOWN_BAD_SOURCE_ENTRIES`
workaround from `scripts/classify-conjugation-words.ts` and the stale
`scripts/migrate-legacy-user-list.ts` (queried pre-1.2.0 table names).
Deleted `vocab-state.md` (a frozen, functionally-dead 0.1.0 progress
snapshot with no forward-looking value, unlike the word list). Added
`scripts/scrub-master-list-cleanup.ts` to apply the same word-level diff to
the DB, run against staging and production. `supabase/README.md`'s Schema
section now documents every FK/unique constraint explicitly, discovered
live while building that script. A related cleanup of
`conjugation-word-list.ts` (which has the same problems, generated from
the pre-cleanup word list) is queued for 2.0.2.

## 2.0.0 — conjugation drills (second activity)

Added a second drill activity alongside vocab drill: conjugation practice
across verb/adjective classes and forms. Progress tracked per
`(word_class, form_id)` cell rather than per word, since a frequency-ranked
word list contains far more words than distinct conjugation patterns.
Grading tries an exact deterministic match first (`conjugation-engine.ts`),
falling through to Claude only for leniency checks, wrong-answer hints, and
success-path examples. Word readings/meanings and translation QA for all
593 drillable words were done via Claude Code subagents, not the metered
API.

## 1.2.0 — table rename (prep for conjugation drills)

Renamed `sessions`/`session_attempts` to `vocab_sessions`/
`vocab_session_attempts` — the bare names carried no vocab-specific token,
so once conjugation drills added their own `conjugation_sessions` table
the old names would have misleadingly read as shared/generic. Pure rename,
no semantics changed — but Postgres doesn't auto-rename constraints,
indexes, or identity sequences along with a table, so those needed
explicit renames too.

## 1.1.0 — activity-picker scaffolding

Prepared the app to support more than one activity. Added the
`ACTIVITIES` registry (`src/lib/activities.ts`) and `ActivityPicker.svelte`;
moved all vocab-drill state/logic out of `+page.svelte` and into
`VocabDrillActivity.svelte`, leaving `+page.svelte` as a thin
user-then-activity-picker shell. No DB schema changes — existing tables
stayed exactly as they were, since nothing yet justified guessing at a
future activity's shape.

## 1.0.0 — pre-1.0 hardening

Closed the remaining gaps from a pre-1.0 review: rate limiting extended to
the session start/complete routes (both write to Supabase and
`session/start` bumps `session_index`, so an unbounded retry loop there was
a real stability risk). Added `.github/workflows/ci.yml` (lint/check/test
on every PR and push to `main`). Added test coverage for the
auth/ownership boundary itself. Added `Strict-Transport-Security` and
`Permissions-Policy` headers, and a "Lock" button on the passphrase gate.

## 0.6.0 — stability and security hardening

A full codebase review turned up: zero server-side logging, zero rate
limiting, no retries around Supabase calls, a non-constant-time secret
comparison, and a real IDOR (`listId`/`userId` were fully client-supplied
with no ownership binding — Supabase's RLS gave no protection since every
route uses the service-role key). All fixed: constant-time secret compare,
per-IP rate limiting, `verifyListOwnership` on every list-scoped route,
`withRetry` around Supabase calls, structured error logging to both
console and a new `error_events` table. A hand-rolled CSP header shipped
initially and broke hydration in the real Vercel build (not reproducible
against `vite dev`) — fixed by moving CSP into `vite.config.ts`'s
`sveltekit({ csp })` option instead, which lets SvelteKit generate a
matching per-request nonce automatically.

## 0.5.0 — LLM prompt hardening

Hardened the app's only LLM integration (`claude-evaluate.ts`). Free-typed
learner text is now wrapped in `<untrusted>` tags with an explicit
instruction not to treat it as commands. Added length caps on graded text
and uploaded word lists. Added an explicit 20s timeout on the Anthropic
client (previously the SDK default of 10 minutes could hang the UI
indefinitely). Ran a live Sonnet-vs-Haiku comparison before moving
`explain_word` to Haiku; `grade_answer`/`evaluate_sentence` stayed on
Sonnet since Haiku graded a loosely-phrased-but-correct answer as wrong. A
follow-up pass fixed two grading bugs (rejecting naturally-subject-omitted
sentences, marking unnatural-but-grammatical sentences unacceptable
instead of suggesting a rewrite) and pinned feedback language to
lower-intermediate Japanese via an explicit grammar-jargon denylist.

## 0.4.0 — word-picking algorithm overhaul

Fixed several issues in the due-word selection algorithm: a word answered
correctly on its true first exposure now jumps straight to box 4 instead
of crawling through boxes 1-3; an incorrect answer on an already-tracked
word steps the box down by 1 instead of resetting to 0; due-word selection
became round-robin across boxes 0-4 instead of a strict box-ascending sort,
so a large box-0 backlog can't starve box 1-4 reviews; same-box ties now
break deterministically. Confined entirely to the pure functions in
`drill-algorithm.ts`, no schema/UI changes.

## 0.3.0 — UI/UX polish

A full design pass over what had been almost entirely unstyled: a
CSS-custom-property design-token system with light/dark themes, a
slate/indigo/emerald/rose palette, the target word as a framed card, a
fixed-position action-button slot so layout doesn't shift during grading,
WCAG-AA-passing contrast throughout, and the self-maintaining footer. No
functionality or schema changes.

## 0.2.2 — remove dead 0.1.0 migration scripts

Removed `migrate-vocab-master.ts`/`migrate-vocab-state.ts`/
`parse-vocab-files.ts` once their target table (`vocab_master`) was
dropped by 0.2.0's finalize migration.

## 0.2.1 — pin vite

Pinned `vite` to an exact `8.0.16` (not a caret range): 8.1.x's default
Rolldown-based dependency optimizer misresolves the project root when run
inside a git worktree, breaking `dev`/`build`/`vitest`.

## 0.2.0 — multi-user, multi-list

Added `users`/`word_lists`/`list_words`; scoped `word_state`/`sessions`/
`session_attempts` by `list_id` instead of a single global vocabulary
(per-list `session_index`, not global). Two real users migrated in:
`dilyan` (original data owner, real historical progress) and `vanya`
(fresh account, own copy of the same starter list).

## 0.1.0 — initial scaffold

Scaffolded the SvelteKit PWA, added the one-time data migration scripts
that seeded a single global vocabulary/progress from
`japanese-2000-most-frequent-words.md`/`vocab-state.md` into Supabase,
built the deterministic drill algorithm module, and added the Claude API
proxy for grading/explaining/sentence evaluation.
