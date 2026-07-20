## Project Configuration

- **Language**: TypeScript
- **Package Manager**: npm
- **Add-ons**: prettier, eslint, sveltekit-adapter

---

## Keeping this doc useful

This file describes yutakanagoi **as it currently works** — architecture,
conventions, the drill algorithm's exact spec. It is not a changelog, and
it shouldn't become one again. When something changes:

- **A current behavior/architecture fact changes** (a file moved, a
  pattern changed, a new convention adopted) → edit the relevant section
  below **in place**. Don't append a new dated bullet.
- **What shipped and why, in a sentence or three** → add one entry to
  `CHANGELOG.md`.
- **Deep session-specific detail** (verification steps taken, PR/branch
  numbers, mistakes caught mid-review, exact commands/sequencing used,
  false starts) → Claude Code's local memory, not either committed file.
  If it wouldn't help a human contributor or a fresh agent reading this
  repo cold, it doesn't belong in this file or `CHANGELOG.md`.

---

## Architecture

Yutakanagoi is a SvelteKit PWA, deployed on Vercel, with all state in
Supabase. Each of the app's (manually-created, never self-registered)
users has their own username + password, verified server-side and backed
by an httpOnly session cookie (`sessions` table, keyed by a hashed opaque
token — see `src/lib/server/session.ts`). Every mutating/data route
derives `userId` from that session (`requireUserId`, populated by
`hooks.server.ts`) rather than trusting a client-supplied id, so the
ownership checks described below are a real second layer (guarding against
a bug passing the wrong id) rather than the *only* thing standing between
one user's data and another's.

### Data model

Two independent activities share the `users` table but otherwise keep
separate schemas — see `supabase/README.md` for full table definitions and
constraints (don't duplicate that detail here):

- **Vocab drill**: each user has their own private word lists
  (`word_lists`), each list's words in `list_words`, progress scoped per
  `(list_id, word)` in `word_state`, sessions in `vocab_sessions`/
  `vocab_session_attempts`. Progress is never shared across lists or users.
  `japanese-2000-most-frequent-words.md` is the default/reference word
  list — real, current, maintained vocabulary, but **not wired into the
  running app's read/write path**: nothing reads this file live, its
  content was copied into each `word_lists` row named after it once, at
  list-creation time. Editing it never *automatically* changes the app's
  behavior; reaching already-created lists needs a companion DB
  migration/scrub script (`scripts/scrub-master-list-cleanup.ts` is a
  worked example). Uploads accept either a one-word-per-line `.txt`/`.md`
  file or an AnkiApp deck `.xml` export (parsed client-side by
  `src/lib/ankiapp-deck-parser.ts`'s `parseAnkiAppDeck`, which reads each
  `<card>`'s `<japanese>` field and discards the `Meaning` field — meanings
  come from Claude at drill time, never from the source list). AnkiApp lets
  a card's Japanese field carry a furigana reading override using doubled
  corner brackets appended to the word (e.g. `過ぎる「「すぎる」」`) —
  `parseAnkiAppDeck` strips a trailing `「+...」+` run before returning the
  word, so this never leaks into `word` text. Both paths converge on the
  same `words: string[]` sent to `/api/lists/upload`; the database has no
  record of which format a list originated from. The list name is always
  derived from the uploaded filename via `src/lib/list-naming.ts`'s
  `deriveListName` — extension stripped, kebab-cased (e.g. `HelloTalk.xml`
  → `hello-talk`). A word already in a list can be corrected in place from
  the drill card itself (an inconspicuous edit icon, available whenever the
  word block is shown) via `renameListWord`
  (`src/lib/server/user-list-repository.ts`) and
  `POST /api/lists/words/edit` — same composite-FK-safe rename dance as
  `scripts/scrub-master-list-cleanup.ts`'s `REPLACE_PAIRS` flow, generalized
  to one arbitrary word (see `supabase/README.md`'s migration gotchas).
- **Conjugation drill**: no per-user lists — one shared word-class/form
  registry (`src/lib/conjugation-word-list.ts` + `conjugation-forms.ts`,
  static code, not a table). Progress is tracked per `(user_id, cell_id)`
  in `conjugation_state`, where `cell_id` is the opaque
  `"wordClass:formId"` string from `conjugation-forms.ts`'s `cellId()`
  (e.g. `"godan_mu:causative_passive_past"`) — all godan-む verbs share one
  box for a given form, since a frequency-ranked word list contains far
  more words than distinct conjugation patterns. New cells are introduced
  with a guaranteed minimum per session (`MIN_NEW_SLOTS_PER_SESSION`, see
  `drill-algorithm.ts` below — shared with vocab drill, not
  conjugation-specific), so the full 319-cell registry stays reachable
  regardless of review backlog.

### Activities

`src/lib/activities.ts` holds a plain-data `ACTIVITIES` registry
(`{ id, label, description }`, no component references) with a
`getActivity(id)` lookup. `src/routes/+page.svelte` is a thin shell:
`ActivityPicker` (renders one button per registry entry) → the chosen
activity's component, via an `{:else if}` chain — identity is already
resolved by the time this page renders (see `+layout.server.ts`/
`LoginForm.svelte` below), so the shell no longer has its own user-picking
step. Each activity owns its own setup steps and state — e.g.
`ListSelector` renders from inside `VocabDrillActivity.svelte`, not the
shell, since which list to drill is vocab-drill's own concern, not
something every activity shares.

To add a new activity: append one entry to `ACTIVITIES`, add one new
component under `src/lib/components/activities/`, add one `{:else if}`
branch in `+page.svelte`. No changes needed to `ActivityPicker.svelte` or
any DB table.

### Key files

- `src/lib/drill-algorithm.ts` — pure, list/cell-agnostic due-word
  selection and box-transition logic (see the spec below). Unit-tested in
  `drill-algorithm.test.ts`. Shared by both activities; if you're changing
  drill behavior, this is the file to edit. `selectDrillWords`'s
  `minNewSlots` param (default 0, so a caller that omits it is unaffected)
  reserves up to that many session slots for never-before-seen items
  regardless of due-review backlog — but only as many as actually remain
  untracked, so the reservation drops to 0 (not wasted capacity) once
  every word/cell has been introduced. Without this, a master
  list/registry bigger than `limit * 16` (box 4's base interval) can
  permanently cap how many distinct items are ever introduced once
  review-only demand saturates the session limit — both session-start
  endpoints pass the shared `MIN_NEW_SLOTS_PER_SESSION` constant, since
  vocab's ~2000-word bundled master list and conjugation's 319-cell
  registry both exceed that ceiling. `nextBox4Streak`/`effectiveInterval`
  are the other piece both activities share: box 4's due interval is no
  longer flat — it grows by one session per additional correct review
  while still at box 4 (16, 17, 18, ...), reset to 0 the instant a word
  drops back out of box 4. See the spec below for both.
- `src/lib/conjugation-engine.ts` — `conjugate()`, a pure deterministic
  function. Grading tries an exact match against it first (zero Claude
  calls for the common case).
- `src/lib/server/claude-evaluate.ts` — the only Claude API integration,
  called from `/api/evaluate`. Modes: vocab's `grade_answer`/
  `explain_word`/`evaluate_sentence`; conjugation's
  `conjugation_leniency_check` (accepts valid orthographic variants),
  `conjugation_hint` (grounded in the verified-correct answer, not the
  model's own recall, so it can tell "wrong stem entirely" from "right
  stem, wrong transformation" instead of citing a possibly-mismatched verb
  from memory), `conjugation_example` (grounded in the word's `meaning`,
  since many words share the same kana reading and the model can't
  otherwise tell which one it's meant to write a sentence about — retried
  once if the sentence doesn't literally contain the drilled form).
- `src/lib/server/user-list-repository.ts` (`verifyListOwnership`) and
  `src/lib/server/conjugation-auth.ts` (`verifyUserExists`) — ownership
  checks. Conjugation drills have no `listId` to check against, so
  `verifyUserExists` is the lighter equivalent.
- `src/lib/server/drill-repository.ts` / `conjugation-repository.ts` —
  per-activity Supabase data access.
- `src/hooks.server.ts` — sets security headers
  (`Strict-Transport-Security`, `Permissions-Policy`) and the
  `handleError` hook (logs unexpected errors to both `console.error` and
  the `error_events` table — read recent ones with `npm run logs:errors`,
  not the Vercel dashboard, since Vercel's own log retention is short and
  this repo has no linked Vercel CLI session). **CSP is configured via
  `vite.config.ts`'s `sveltekit({ csp: {...} })` option, never as a static
  header in `hooks.server.ts`** — SvelteKit always inlines a small
  hydration-bootstrap `<script>` whose content (chunk filenames) changes
  every build, so a static `script-src` can never match it, and hydration
  silently breaks in a real Vercel build (this does *not* reproduce
  against `vite dev` — verify any CSP change against a real Preview
  deployment). Kit's own `csp` option generates a per-request nonce and
  injects it into both the header and that inline script automatically.
- `src/lib/components/LoginForm.svelte` — username + password login,
  rendered by `+layout.svelte` whenever `+layout.server.ts`'s `data.user`
  is null. On success it calls SvelteKit's `invalidateAll()` to re-run
  that load function, which picks up the newly-set session cookie and
  flips the layout to the logged-in app tree — no separate client-side
  "am I logged in" state to keep in sync. The "Log out" button (also in
  `+layout.svelte`) calls `/api/logout` then `invalidateAll()` the same
  way; no separate cleanup needed elsewhere since it unmounts the whole
  app tree, resetting `+page.svelte`'s in-memory state naturally.
- The footer (rendered last inside `<main>` in `+page.svelte`) is
  self-maintaining: version comes from `__APP_VERSION__` (package.json,
  bumped every release), copyright range from `FOUNDING_YEAR` (2026 — the
  year of the first commit, a fixed historical fact, never change it)
  combined with `new Date().getFullYear()` computed at render time, so it
  silently becomes "2026–2027" etc. once a new year starts. Nothing here
  needs a manual touch at release time.

---

## Operating conventions

- **Deployment**: Vercel is connected via its GitHub integration (no
  `vercel.json` — deploys are entirely managed on Vercel's side). Opening
  or updating a PR gets its own **Preview** deployment (Vercel bot
  comments the URL, posts a "Vercel" check); merging to `main` triggers a
  separate **Production** deployment. `.github/workflows/ci.yml` runs
  lint/check/test on every PR and on push to `main`, but `main` has no
  branch protection configured — a green CI check doesn't gate merge, and
  merging is always a manual judgment call. **Don't treat an open PR as
  safe to merge just because checks are green — actually look at the
  Preview.**
- **Verification**: backend/drill-algorithm changes get a real run against
  the local Supabase stack (`npx supabase start`), not just unit tests —
  unit tests catch logic regressions, not integration issues like a wrong
  query shape or a schema assumption that's since drifted.
- **Security/stability pattern**: passwords are hashed with scrypt
  (`src/lib/server/password.ts`), compared in constant time
  (`timingSafeEqual`), never with `===`. Sessions are an opaque random
  token whose SHA-256 hash (not the token itself) is stored in `sessions`
  (`src/lib/server/session.ts`) — `hooks.server.ts` verifies the cookie on
  every request and populates `locals.userId`, and every route that needs
  identity calls `requireUserId(locals)` (`src/lib/server/require-session.ts`)
  rather than trusting a client-supplied `userId`. Every mutating route is
  rate limited per-IP (`src/lib/server/rate-limit.ts`) — in-memory,
  per-instance, resets on cold start and isn't shared across concurrent
  serverless instances/regions; this raises the bar against casual abuse,
  it isn't a hard guarantee (`/api/login` is additionally rate-limited
  per-username, to bound credential stuffing against one account from many
  IPs). Every route that accepts a `listId` still calls
  `verifyListOwnership(supabase, listId, userId)` with the session-derived
  `userId` before touching that list's data. Supabase calls are wrapped in
  `withRetry` (`src/lib/server/retry.ts`) to ride out transient network
  blips.
- **One-time enrichment/data-generation work** (translating word lists,
  classifying data, writing example content, proofreading) uses Claude
  Code itself — parallel subagents reviewing/generating content in the
  session — never `ANTHROPIC_API_KEY` calls. Metered API credits are
  reserved for the running app's actual drill sessions, not one-time prep
  work. When using multiple subagents to review the same kind of content,
  independently verify their output before trusting it — same-model-
  reviewing-same-model-output has real failure modes (a subagent pass can
  produce its own false positives), not just find them.
- **Production data changes**: dry-run → apply to staging → verify →
  confirm with the user → apply to production → verify again. Check the
  live database schema directly (`npx supabase db diff --linked`, see
  `supabase/README.md`) before assuming migration files reflect reality —
  they're the intended source of truth, not a guarantee against
  undocumented drift. Additive migrations (new tables/columns, nothing
  dropped or renamed) can go out before merging the code that uses them,
  since old code stays ignorant of what it doesn't reference; renames or
  other breaking migrations should go out after the code deploy is
  confirmed live, to keep the mismatch window short.

---

## Drill algorithm specification

This is the exact algorithm `src/lib/drill-algorithm.ts` implements —
originally written for a git-committed-markdown workflow (a word-list file
plus a per-word box/`last_session` state file, committed after every
session) that predates the 0.1.0 Supabase cutover. The storage layer
changed; the algorithm below didn't. This is a specification, not
something to execute directly — if asked to "run a drill session" in this
repo, that means using the deployed app or `npm run dev` locally.

State: for each `(list, word)` — or `(user, cell_id)` for conjugation
drills — a `box` (integer 0–4, Leitner-style level: 0 = new/just failed, 4
= mastered), a `last_session` (the `session_index` value when the word
was last drilled — not a date, since sessions are irregular and "sessions
since last seen" is the only clock that matters), and a `box4_streak`
(count of consecutive correct reviews since the word most recently entered
box 4 — irrelevant/0 while `box < 4`, reset to 0 the instant it drops back
out — see box 4's interval below). `session_index` is one counter per list
(or per user, for conjugation drills), incremented once per session, not
per word.

### Session algorithm

Shared by both activities (`src/lib/drill-algorithm.ts`'s
`selectDrillWords`/`applyOutcome`/`pickDueWordsRoundRobin` are reused
unmodified for conjugation drills, which just treat `cell_id` as an opaque
word). At the start of a session:

1. Increment `session_index`.
2. Compute "due" words using this interval table:
   - box 0: due every session
   - box 1: due every 2 sessions
   - box 2: due every 4 sessions
   - box 3: due every 8 sessions
   - box 4: due every `16 + box4_streak` sessions — 16 the first time a
     word reaches box 4 (or returns to it after a slip), then +1 session
     for every additional correct review while it stays at box 4 (16, 17,
     18, ...). Deliberately gentle linear growth, not exponential, so
     long-mastered words space out further over time without effectively
     vanishing from rotation.
   A word is due if `(session_index - last_session) >= interval(box)`.
3. Take up to 10 due words round-robin across boxes 0-4: repeatedly cycle
   through the boxes in order, taking the single most-overdue due word
   (oldest `last_session` first) from each non-empty box in turn, until 10
   words are chosen or all due words are exhausted. Box 0 is still drawn
   from first every cycle, so weaker words remain the priority — but a
   large box-0 backlog can no longer monopolize every slot and starve box
   1-4 reviews indefinitely. Same-box ties break deterministically
   (most-overdue/oldest `last_session` first).
4. If fewer than 10 due words exist, fill remaining slots with new words
   not yet introduced.
5. Don't force box 4 words back in early just to fill a slot.

### Vocab drill loop (per word, within a session)

This is vocab drill's specific per-word interaction
(`VocabDrillActivity.svelte`) — conjugation drill's is different (present
the target form, grade via `conjugate()` first, then hint → retry up to 3
times → reveal on failure; see `claude-evaluate.ts`'s conjugation modes
above), but both sit on top of the same session algorithm above.

1. Present the word one at a time (the user may ask to use it in a
   sentence instead of just testing recall). If this is a new word, do not
   reveal its meaning — let the user guess first, same as a review word.
   Number each prompt (1, 2, 3, ...) as you present it.
2. If the user demonstrates knowledge (recall the meaning / use it
   correctly) → `box += 1` (max 4), move to next word. Exception: a
   brand-new word answered correctly on this very first exposure jumps
   straight to box 4 instead of box 1 — a frequency-ranked word list
   contains many words an intermediate learner already knows, and stepping
   through boxes 1-3 for words that are clearly already mastered just adds
   backlog.
3. If the user doesn't know it or gets it wrong → explain the word, ask
   them to write a sentence using it, evaluate the sentence, then:
   - if this is the word's first exposure, set `box = 0`
   - otherwise, decrement `box` by 1 (floor 0) rather than resetting to 0
     — a single slip shouldn't erase all prior progress
   move on.
4. Update `last_session = current session_index` regardless of outcome.
5. If the word wasn't previously tracked, add it (box 0 if incorrect, or
   box 4 if correct on this first exposure).

No narration: don't list the session's due/new words up front, and don't
give progress updates (box changes, counts like "3/10 done", interval
math) between words. Keep each turn to the interaction itself — prompt,
guess, then explain/correct/ask-for-a-sentence only if needed — and move
straight to the next prompt.
