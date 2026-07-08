## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: prettier, eslint, sveltekit-adapter

---

## Current status: this is a live app, not a markdown-driven workflow

Yutakanagoi is a SvelteKit PWA, deployed on Vercel, with state in Supabase —
not the plain-text-file workflow described in the rest of this file. That
section is kept below as the specification for the drill algorithm's exact
intended behavior, not as an active process.

As of 0.2.0 the app is multi-user and multi-list: each user has their own
private word lists, and progress is scoped per list (not global). Users are
rows in a `users` table (created out-of-band via `scripts/add-user.ts`, never
via the UI); their word lists are rows in `word_lists`, with each list's
words in `list_words`. The `word_state` / `vocab_sessions` / `vocab_session_attempts`
tables from 0.1.0 are unchanged in shape except each gained a `list_id`
column — progress is never shared across lists or users, but there is still
only one shared `APP_SHARED_SECRET` passphrase gating the whole app (no
per-user passwords). See `supabase/README.md` for the full schema.

Useful context for working in this repo:

- The due-word-selection and box-transition logic described below is
  implemented in `src/lib/drill-algorithm.ts` (pure functions, unit-tested in
  `drill-algorithm.test.ts`). It's list-agnostic by design — it takes
  vocab/word-state arrays as plain parameters, so it needed zero changes for
  multi-list support. If you're changing drill behavior, that's the file to
  edit — the rules below are the reference for what it should do.
- `japanese-2000-most-frequent-words.md` (formerly `vocab-master.md`) is
  **not wired into the running app's read/write path** — the app never
  reads this file directly, live data is in Supabase (`users`, `word_lists`,
  `list_words`, `word_state`, `vocab_sessions`, `vocab_session_attempts`
  tables; schema in `supabase/migrations/`, notes in `supabase/README.md`).
  Don't call this file "frozen," though (an earlier version of this doc did,
  and it was misleading) — its content is real, current, maintained
  vocabulary, edited when it has an actual data-quality problem (as 2.0.1
  did, see that release's notes) or content genuinely needs updating.
  **Editing it never *automatically* changes the app's behavior**, since
  nothing reads it live — its content was copied into each `word_lists`
  row named after it once, at list-creation time, so any edit meant to
  reach already-created lists needs a companion DB migration/scrub script
  (2.0.1's `scripts/scrub-master-list-cleanup.ts` is a worked example).
  Unlike this file, `vocab-state.md` (the progress-tracking sibling this
  file used to have) genuinely was frozen — untouched, unread, and
  eventually deleted in 2.0.1: it was a one-time snapshot of one user's
  real progress at the exact moment of the 0.1.0 cutover, migrated into
  `word_state` once by the
  since-removed `migrate-vocab-state.ts` and never read again, with no
  forward-looking reference value the way the word list itself still has.
  The "original spec" section below still documents `vocab-state.md`'s
  format/role in the historical git-sync workflow — that's describing what
  the file *was*, for anyone trying to understand the algorithm's origins,
  not implying the file still exists in this repo.
- Grading, word explanations, and sentence evaluation happen via the Claude
  API through a server-side proxy (`src/lib/server/claude-evaluate.ts`,
  called from `/api/evaluate`) — not by an agent reading these files in a
  chat session.
- The drill UI is `src/routes/+page.svelte`; the passphrase gate protecting
  it is `src/lib/components/PassphraseGate.svelte`; user/list selection
  happens via `UserSelector.svelte`/`ListSelector.svelte` before it.
- If asked to "run a drill session" in this repo, that means using the
  deployed app (or `npm run dev` locally), not following the git sync
  protocol below.
- **Deployment workflow**: Vercel is connected via its GitHub integration (no
  `vercel.json` — deploys are entirely managed on Vercel's side). Confirmed by
  inspecting past PR checks: opening or updating a PR gets its own
  **Preview** deployment (Vercel bot comments the preview URL and posts a
  "Vercel" check on the PR); merging to `main` triggers a separate
  **Production** deployment (a distinct deployment ID from the PR's preview).
  So the workflow is: open a PR → test against its Preview URL → merge →
  Production redeploys automatically from `main`. As of 1.0.0 there's also a
  `.github/workflows/ci.yml` that runs `lint`/`check`/`test` on every PR and
  on push to `main` — but `main` still has no branch protection configured
  (no required reviews/checks), so a green CI check doesn't gate the merge
  either; merging is still a manual judgment call, so don't treat an open PR
  as "safe to merge" just because checks are green — actually look at the
  preview before merging.
- The footer (`src/routes/+page.svelte`, rendered last inside `<main>`) is
  self-maintaining — don't hand-edit it per release. The version comes from
  `__APP_VERSION__` (package.json, already bumped every release per existing
  convention). The copyright range is `FOUNDING_YEAR` (2026, the year of the
  first commit — a fixed historical fact, never change it) combined with
  `new Date().getFullYear()` computed at render time, so it silently becomes
  "2026–2027" etc. on its own once a new year starts. Nothing here needs a
  manual touch at release time.
- **Stability/security hardening (0.6.0)**: `requireAppSecret`
  (`src/lib/server/require-app-secret.ts`) compares the passphrase in
  constant time (`src/lib/server/secrets-match.ts`) rather than with `===`.
  `/api/verify-secret`, `/api/evaluate`, and `/api/lists/upload` are rate
  limited per-IP (`src/lib/server/rate-limit.ts`) — this is an in-memory,
  per-instance fixed window, so it resets on cold start and isn't shared
  across concurrent serverless instances/regions; treat it as raising the
  bar against casual abuse, not a hard guarantee. Every route that accepts
  both a `listId` and `userId` now calls `verifyListOwnership`
  (`src/lib/server/user-list-repository.ts`) first — this is still the
  single-shared-secret trust model (no per-user auth), it just stops a
  typo'd/guessed `listId` from reading or writing a different user's data.
  Supabase calls are wrapped in `withRetry` (`src/lib/server/retry.ts`) to
  ride out transient network blips. Unexpected server errors are logged via
  `src/hooks.server.ts`'s `handleError` hook to both `console.error`
  (structured JSON) and an `error_events` Supabase table (see
  `supabase/README.md`) — read recent ones with `npm run logs:errors`
  instead of the Vercel dashboard, since Vercel's own log retention is
  short and this repo has no linked Vercel CLI session.
- **1.0.0**: closed the remaining gaps from the pre-1.0 review.
  `/api/session/start` and `/api/session/complete` are now rate limited
  per-IP too (same `checkRateLimit` pattern as the other mutating routes) —
  both write to Supabase and `session/start` bumps `session_index`, which
  the due-word interval math depends on, so an unbounded retry loop there
  was a real stability gap, not just a cost one. Added
  `.github/workflows/ci.yml` (lint/check/test on every PR and on push to
  `main` — see the deployment-workflow note above for why this doesn't gate
  merges). Added test coverage for the auth/ownership boundary itself
  (`require-app-secret.test.ts`, `user-list-repository.test.ts`, and route
  wiring tests for the two session routes) — this required adding the
  `sveltekit()` Vite plugin to `vitest.config.ts` so `$env`/`$lib` resolve in
  tests; reuse that setup for any future test that touches server modules
  importing them. `hooks.server.ts` also sets `Strict-Transport-Security`
  and `Permissions-Policy` now, and `PassphraseGate.svelte` has a small
  "Lock" button (clears the stored secret and re-locks) — no separate
  cleanup needed elsewhere since re-locking unmounts the whole app tree,
  which resets `+page.svelte`'s in-memory state naturally on next unlock.
- **1.1.0**: prepared the stage for more than one activity (2.0.0's goal is
  a second, not-yet-designed activity alongside vocab drills). Added
  `src/lib/activities.ts` — a plain-data `ACTIVITIES` registry
  (`{ id, label, description }`) with a `getActivity(id)` lookup, no
  component references stored in it — and `src/lib/components/
  ActivityPicker.svelte`, which renders one button per registry entry and
  reports the chosen id via the same `onSelect` callback shape already used
  by `UserSelector`/`ListSelector`. `src/routes/+page.svelte` is now a thin
  shell holding just `selectedUserId`/`selectedUsername` and the new
  `selectedActivityId`, switching between `UserSelector` → `ActivityPicker`
  → the chosen activity's component via an `{:else if}` chain (fade
  transitions between the three, see `src/lib/client/motion.ts` for the
  `prefers-reduced-motion` guard). All the vocab-drill state and logic that
  used to live directly in `+page.svelte` (the `phase` state machine,
  `start`/`submitAnswer`/`submitSentence`/`finishSession`/`cancelSession`,
  etc.) moved into `src/lib/components/activities/VocabDrillActivity.svelte`
  (props: `userId`, `username`, `onExit`). List selection moved with it —
  `ListSelector` is rendered from inside `VocabDrillActivity`, not the
  shell, since which list to drill is vocab-drill's own setup step, not a
  concept every future activity will necessarily share. To add activity #2:
  append one entry to `ACTIVITIES`, add one new component under
  `src/lib/components/activities/`, and add one `{:else if}` branch in
  `+page.svelte` — no changes needed to `ActivityPicker.svelte`,
  `UserSelector.svelte`, or any DB table. Deliberately **no DB schema
  changes** this release: `sessions`/`session_attempts`/`word_state`/
  `word_lists`/`list_words` stay exactly as they are — they're all
  vocab-drill-specific already, and nothing stops activity #2 from picking
  its own distinct table names later, so reserving/renaming anything now
  would just be guessing against an unknown future shape. Also deliberately
  **not** persisting the last-picked activity in localStorage (unlike
  `user-selection.ts` for the user) — with only one real activity there's
  nothing yet to validate that behavior against, and adding a third,
  differently-behaved persistence pattern on top of the existing
  `UserSelector` (remembers) / `ListSelector` (doesn't) split would make
  that inconsistency worse, not better. Revisit once activity #2 exists.
- **1.2.0**: prep work ahead of activity #2 (conjugation drills). Renamed
  `sessions`/`session_attempts` to `vocab_sessions`/`vocab_session_attempts`
  — unlike `word_state`/`word_lists`/`list_words`, those two names carried
  no vocab-specific token, so once conjugation drills add their own
  `conjugation_sessions`/`conjugation_session_attempts` tables, the bare
  `sessions` name would misleadingly read as shared/generic. Pure rename —
  no column, data, or constraint/RLS semantics changed, only names (plus
  the underlying constraints/indexes/identity sequences, which Postgres
  doesn't auto-rename along with the table).
- **2.0.0**: activity #2 — conjugation drills, alongside vocab drill.
  Deliberately **not** built on `word_lists`/`list_words`: conjugation
  progress is tracked per `(word_class, form_id)` cell (e.g. all
  godan-む verbs share one box for the causative-passive-past form), not
  per specific word — a frequency-ranked word list contains far more
  words than distinct conjugation patterns, so per-word progress would
  just be redundant bookkeeping for cells that behave identically. New
  tables `conjugation_state`/`conjugation_sessions`/
  `conjugation_session_attempts` (schema + rationale in
  `supabase/README.md`), keyed by `user_id` only — no `list_id`, since
  the registry (`src/lib/conjugation-forms.ts`'s form lists ×
  `src/lib/conjugation-word-list.ts`'s ~593 drillable words, both static
  code data generated once via `scripts/classify-conjugation-words.ts`
  and hand-reviewed, not a DB table) is shared across all users, not
  per-list. `src/lib/conjugation-engine.ts`'s `conjugate()` is a pure,
  deterministic function — grading tries an exact match against it
  first (zero Claude calls for the common case), only falling through to
  `claude-evaluate.ts`'s new `conjugation_leniency_check` (accepts valid
  orthographic variants), `conjugation_hint` (wrong-answer explanation,
  grounded in the verified-correct answer so it can distinguish "wrong
  word/stem entirely" from "right stem, wrong transformation" instead of
  citing possibly-mismatched comparison verbs from memory), or
  `conjugation_example` (success-path example sentence, retried once if
  it doesn't literally contain the drilled form) — bumped `/api/evaluate`'s
  rate limit to 45/5min accordingly, since one drilled cell can now cost
  up to 3 Claude calls instead of vocab's ~1-2.
  `buildConjugationRegistry()` enumerates cells via **diagonal**
  traversal (increasing class-index + form-index sum) rather than
  class-major or form-major order — either axis-major order means a
  session's first ~10 cells are monotonous (all one form across many
  classes, or all one class across many forms); diagonal traversal
  guarantees an early session already spans multiple classes and forms.
  Per-word `reading`/`meaning` and the per-session composed target-form
  gloss (e.g. "to wait" + negative → "doesn't wait", needs real English-
  grammar judgment so isn't template-generated) were filled in as
  **non-API** work — Claude Code itself (parallel subagents), not
  `ANTHROPIC_API_KEY` calls — per [[feedback_no_api_calls_for_prep_work]]:
  one-time enrichment/review work should spend the Claude Code
  subscription, not metered API credits reserved for the running app's
  actual drill sessions. Same non-API approach used for a final
  translation-correctness pass across all 593 drillable words, which
  caught and fixed 6 wrong readings/meanings (e.g. はぐ was glossed "to
  brush" instead of "to peel off").
- **2.0.1**: first of a series of patch releases working through existing
  open issues/tech debt before starting activity #3 — this one closes
  issue #25 (`japanese-2000-most-frequent-words.md` data-quality cleanup).
  130 entries removed and 2 replaced with their standard spelling, via
  three rounds of parallel Claude Code subagents (not the Anthropic API,
  per [[feedback_no_api_calls_for_prep_work]]) classifying the full
  2000-word list against itself, each followed by an independent
  verification pass: round 1 (16 batches) found 85 issues, round 2 (8
  batches, on the round-1 result) found 39 more, round 3 (8 batches) found
  8 more — a converging, diminishing-returns curve, not evidence the
  process was broken. Categories: confirmed corrupt/truncated fragments
  (the original issue's まえる/ばる plus ばる's known-bad siblings 隠る/恐る/
  ごとし, and others like うい/かる/つた/たく), bare kana on'yomi readings
  that are never standalone words (けい, しん, げん, etc. — ~30 of these),
  nonstandard okurigana where the standard form was already listed (分る→
  already-listed 分かる, 行なう→行う, etc.), kana/kanji duplicate pairs of a
  lexeme already present under its standard spelling (もどる/戻る, うえ/上,
  のむ/飲む, まわり/周り — the largest category), and one obscure personal
  name that had leaked in (圭一). Two replacements (やみ→闇, ほる→掘る) where
  no standard-spelling entry already existed. Deliberately did **not**
  remove common country/city names (東京, アメリカ) despite an early pass
  flagging them as "proper nouns" — those are genuinely high-frequency,
  useful learner vocabulary, unlike 圭一's obscure-name-as-corpus-artifact
  case. Also did not remove kana words just because they're ambiguous about
  which kanji they map to (かな, ちまう, ふく, たま, はく, とく survived for
  this reason) — ambiguity isn't the same as "not a real word." Every
  automated word-level edit to the file went through a deterministic
  apply script that re-derives each change's expected word straight from
  the file by rank and aborts the whole write on any mismatch (verifies
  the classification agents actually read the real file rather than
  hallucinating content) — ran clean (zero mismatches) across all three
  rounds. Removed the now-dead `KNOWN_BAD_SOURCE_ENTRIES` workaround from
  `scripts/classify-conjugation-words.ts`, since all 5 of its entries are
  now gone from the source file. New one-time script
  `scripts/scrub-master-list-cleanup.ts` applies the same word-level diff
  to the DB — necessary because `japanese-2000-most-frequent-words.md`'s
  content was copied into `list_words` for the two accounts originally
  created by the now-deleted `scripts/migrate-legacy-user-list.ts` (see
  `supabase/README.md`), so the file being unread by the running app
  doesn't mean editing it has zero downstream effect.
  Verifying this against the local Supabase stack first (per
  [[feedback_verify_against_local_db]]) surfaced two real constraints not
  documented in the README's prose: `word_state` and `vocab_session_attempts`
  both have an actual FK to `list_words(list_id, word)` (not just
  informally-shared columns), and `list_words` has a unique constraint on
  `(list_id, frequency_rank)`. That means (1) removing a word requires
  deleting its `vocab_session_attempts` rows too, not just leaving them as
  an untouched historical log as originally planned — a record of
  "drilling" a word later determined to be corrupt/duplicate/archaic isn't
  worth keeping, and the FK actively prevents leaving it dangling anyway;
  (2) an in-place spelling replacement can't simply update `list_words.word`
  or insert-then-delete at the same rank — it has to insert the new
  spelling at a temporary negative placeholder rank (real ranks are always
  positive), repoint `word_state`/`vocab_session_attempts` to it, delete the
  old row, then restore the real rank. Both real users (`dilyan`, `vanya`)
  had zero `word_state`/`vocab_session_attempts` rows for any removed word,
  so this cleanup had no drill-progress impact in practice. Script run
  dry-run → real on staging → dry-run (idempotency check) → same sequence
  on production, per [[feedback_production_migration_discipline]], with an
  explicit output line always printing the resolved `SUPABASE_URL` so which
  database a run targets is never ambiguous. `supabase/README.md`'s Schema
  section now documents every FK/unique constraint explicitly per table
  (not just prose) plus a dedicated "migration gotchas" callout, so the
  FK/rank-collision issues above don't have to be rediscovered live against
  a real stack next time. Also removed `scripts/migrate-legacy-user-list.ts`
  as part of the same pass — it queried the pre-1.2.0 table names
  (`sessions`/`session_attempts`), so it would error if run today, and there's
  no remaining 0.1.0 legacy data left for it to migrate anyway. A broader
  dead-code sweep across `src/lib`, `package.json` dependencies, and
  components found nothing else actionable — a few types/functions are
  exported but only ever consumed within their own defining file (harmless
  over-export, not dead code) and `@sveltejs/vite-plugin-svelte` looks
  unused by grep but is a required peer dependency of `@sveltejs/kit`, so
  don't remove it if this sweep is ever repeated. Also deleted
  `vocab-state.md`, user-confirmed: unlike the word list, it had no
  forward-looking reference value (a frozen one-time snapshot of real
  progress from the exact moment of the 0.1.0 cutover, migrated into
  `word_state` once and never read again) — see the "Current status" section
  above, which also stopped calling the word list itself "frozen": that
  framing was misleading once a release (this one) started actually editing
  its content for legitimate data-quality reasons.
  **Follow-up queued for 2.0.2** (see
  [[project_conjugation_word_list_cleanup_needed]]): the same data-quality
  problems fixed here also exist in `src/lib/conjugation-word-list.ts`,
  since it was generated by classifying words from the *original* uncleaned
  master list — 96 of the 132 words changed here are also present there,
  42 of them in currently-drillable (`included: true`) verb/i-adjective
  entries. Deliberately not fixed in this release: different file, no DB
  migration needed (conjugation tables key on `cell_id`, not word text), and
  it needs its own care around internal duplicates within that file.

---

# Yutakanagoi — Japanese vocabulary drill tool (original spec)

This section describes the plain-text-file workflow the app above replaced.
It's kept as the precise specification the app's algorithm and drill loop
were built from — useful if you need to check intended behavior, not as
something to execute directly.

## Files

- `japanese-2000-most-frequent-words.md` (formerly `vocab-master.md`) — the
  full target vocabulary list. Rarely changes. Source of truth for what
  words exist.
- `vocab-state.md` — tracks only words that have been drilled at least once. Schema:

  ```
  session_index: <integer>

  word       | box | last_session
  持つ        | 2   | 12
  食べる      | 0   | 14
  ```

  - `box`: integer 0–4 (Leitner-style level). 0 = new/just failed, 4 = mastered.
  - `last_session`: the `session_index` value when the word was last drilled (not a
    date — sessions are irregular, so "sessions since last seen" is the only clock
    that matters).
  - `session_index`: one counter for the whole project, incremented once per session
    (not per word).
  - Words not yet in this file are implicitly "not yet introduced" — derive that by
    diffing against `japanese-2000-most-frequent-words.md`. Don't track untouched
    words here.

Keep state minimal — no timestamps, no per-attempt history, no logged example
sentences. Just word, box, last_session, plus the session_index counter.

## Session algorithm

At the start of a session:

1. Increment `session_index`.
2. Compute "due" words from `vocab-state.md` using this interval table:
   - box 0: due every session
   - box 1: due every 2 sessions
   - box 2: due every 4 sessions
   - box 3: due every 8 sessions
   - box 4: due every 16 sessions (flat interval — doesn't keep growing)
   A word is due if `(session_index - last_session) >= interval(box)`.
3. Take up to 10 due words round-robin across boxes 0-4: repeatedly cycle through
   the boxes in order, taking the single most-overdue due word (oldest
   `last_session` first) from each non-empty box in turn, until 10 words are chosen
   or all due words are exhausted. Box 0 is still drawn from first every cycle, so
   weaker words remain the priority — but a large box-0 backlog can no longer
   monopolize every slot and starve box 1-4 reviews indefinitely.
4. If fewer than 10 due words exist, fill remaining slots with new words from
   `vocab-master.md` that aren't yet in `vocab-state.md`.
5. Don't force box 4 words back in early just to fill a slot.

## Drill loop (per word, within a session)

1. Present the word one at a time (the user may ask to use it in a sentence instead
   of just testing recall). If this is a new word (not yet in `vocab-state.md`), do
   not reveal its meaning — let the user guess first, same as a review word. Number
   each prompt (1, 2, 3, ...) as you present it.
2. If the user demonstrates knowledge (recall the meaning / use it correctly) →
   `box += 1` (max 4), move to next word. Exception: a brand-new word (not yet in
   `vocab-state.md`) that's answered correctly on this very first exposure jumps
   straight to box 4 instead of box 1 — a frequency-ranked word list contains many
   words an intermediate learner already knows, and stepping through boxes 1-3 for
   words that are clearly already mastered just adds backlog.
3. If the user doesn't know it or gets it wrong → explain the word, ask them to write
   a sentence using it, evaluate the sentence, then:
   - if this is the word's first exposure, set `box = 0`
   - otherwise, decrement `box` by 1 (floor 0) rather than resetting to 0 — a single
     slip shouldn't erase all prior progress
   move on.
4. Update `last_session = current session_index` for the word regardless of outcome.
5. If the word wasn't previously in `vocab-state.md`, add it (box 0 if incorrect, or
   box 4 if correct on this first exposure).

No narration: don't list the session's due/new words up front, and don't give
progress updates (box changes, counts like "3/10 done", interval math) between
words. Keep each turn to the interaction itself — prompt, guess, then explain/
correct/ask-for-a-sentence only if needed — and move straight to the next prompt.

## Git sync protocol

At the start of every session:

1. Run `git pull` before reading `vocab-state.md`, to make sure you're reading the
   latest state (it may have been updated from a different device/session).
2. If pull reports local changes that would be overwritten, stop and tell the user —
   don't force-resolve silently.

At the end of every session:

1. Write the updated `vocab-state.md` to disk.
2. `git add vocab-state.md`
3. `git commit -m "session <session_index>: <brief summary, e.g. 'drilled 10 words,
   3 moved to box 0'>"`
4. `git push` directly to main — no branches, no PRs.
5. Confirm the push succeeded before telling the user the session is done — if it
   fails (e.g. network issue, conflict), tell them explicitly rather than reporting
   success. Once the push is confirmed, state: "Session complete."

Only `vocab-state.md` gets committed automatically like this. If
`japanese-2000-most-frequent-words.md` or `CLAUDE.md` need changes, ask the
user first before committing those.
