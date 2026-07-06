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
words in `list_words`. The `word_state` / `sessions` / `session_attempts`
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
- `japanese-2000-most-frequent-words.md` (formerly `vocab-master.md`) and
  `vocab-state.md` are frozen as of the 0.1.0 cutover. They are **not** read
  or written by the running app and do not reflect current progress — live
  data is in Supabase (`users`, `word_lists`, `list_words`, `word_state`,
  `sessions`, `session_attempts` tables; schema in `supabase/migrations/`,
  notes in `supabase/README.md`). Don't edit these two files expecting it to
  affect the app, and don't treat them as current.
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
- **Deployment workflow**: Vercel is connected via its GitHub integration
  (no `vercel.json`, no GitHub Actions in this repo — deploys are entirely
  managed on Vercel's side). Confirmed by inspecting past PR checks: opening
  or updating a PR gets its own **Preview** deployment (Vercel bot comments
  the preview URL and posts a "Vercel" check on the PR); merging to `main`
  triggers a separate **Production** deployment (a distinct deployment ID
  from the PR's preview). So the workflow is: open a PR → test against its
  Preview URL → merge → Production redeploys automatically from `main`.
  `main` has no branch protection configured (no required reviews/checks as
  of 0.3.0) — merging is a manual judgment call, not gated by CI, so don't
  treat an open PR as "safe to merge" just because checks are green; actually
  look at the preview before merging.
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
