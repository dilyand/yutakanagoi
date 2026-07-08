# Supabase schema

Versioned SQL migrations for the drill app's data store live in
`supabase/migrations/`. This directory was set up with `supabase init`
(Supabase CLI); `supabase/config.toml` configures the local dev stack.

## Environments

There are two real (non-local) Supabase projects:

- **Production** (`suibcyizndchihpzaodc`) — the real vocab list and drill
  progress. Vercel's Production environment variables point here.
- **Staging/preview** (`vlvndoglveivlxejjuzn`) — a throwaway project seeded
  with a copy of the same vocab list and progress, used so that testing a
  Preview deployment (e.g. installing it on a phone and playing through
  drill sessions) can never corrupt real progress. Vercel's Preview
  environment variables point here instead. If this project ever needs
  re-seeding (schema changes, fresh copy of progress), `link` the CLI to it
  and re-run the migration scripts below against it — same process as
  production, different project ref.

## Applying migrations

**Local development** (requires Docker):

```sh
npx supabase start   # spins up local Postgres + stack, applies all migrations
npx supabase stop    # tears it down
npx supabase db reset  # drops and re-applies all migrations from scratch
```

**Against a real Supabase project:**

```sh
npx supabase link --project-ref <project-ref>   # SUPABASE_ACCESS_TOKEN must be set
npx supabase db push
```

`supabase/.temp/project-ref` records whichever project is currently linked.
If you need to point the CLI at a different project temporarily (e.g. to
re-seed a staging project), `link` to it, run your commands, then `link`
back to the production ref — it's just a local pointer, safe to switch.

**Before trusting any constraint documentation in this file (including the
Schema section below) as current, verify it directly against the live
database rather than just reading migration files by hand** — migration
files are the intended source of truth, but the only way to know for
certain there's no undocumented drift (a manual change made directly in the
Supabase dashboard/SQL editor, or in some tool that isn't this repo) is to
ask the live database itself:

```sh
npx supabase link --project-ref <project-ref>
npx supabase db diff --linked --schema public   # read-only; "No schema changes found" = no drift
```

Run this against both `suibcyizndchihpzaodc` (production) and
`vlvndoglveivlxejjuzn` (staging) — remember to `link` back to whichever
project you started on afterward, since it's a shared local pointer, not
per-command. Confirmed **zero drift on both** as of 2026-07-08, right before
writing this note and the constraint documentation below — every FK/unique
constraint documented in this file was cross-checked against the live
schema, not just inferred from reading `.sql` files.

## Schema

- `users` — one row per person using the app (`username`, unique). Created
  out-of-band via `scripts/add-user.ts`, never through the app itself.
- `word_lists` — one row per uploaded/migrated word list (`user_id`, `name`).
  Private per user; `name` is always the uploaded filename, unique per user.
  **Constraints:** `user_id` → `users(id)`; unique `(user_id, name)`.
- `list_words` — one row per word in a list (`list_id`, `word`,
  `frequency_rank`).
  **Constraints:** `list_id` → `word_lists(id)`; unique `(list_id, word)`
  **and** unique `(list_id, frequency_rank)` — the second one is easy to
  forget since most code only ever thinks in terms of `word`, but it means
  you can't insert a new spelling at a rank that's still occupied by the
  word it's replacing (see the migration gotchas below).
- `word_state` — one row per word that's been drilled at least once within a
  list (`list_id`, `word`, `box` 0-4, `last_session`). Progress is scoped to
  `(list_id, word)`, not shared across lists or users.
  **Constraints:** `list_id` → `word_lists(id)`; composite
  `(list_id, word)` → `list_words(list_id, word)` (not a plain FK on `word`
  alone — see below); unique `(list_id, word)`.
- `vocab_sessions` — one row per drill session (`list_id`, `session_index`,
  `started_at`, `completed_at`, `words_drilled`). `session_index` is a
  per-list counter (not global) — the due-word interval algorithm measures
  "sessions since last seen" for one list's own history, so mixing counters
  across lists would give wrong due-dates. See `src/lib/drill-algorithm.ts`
  and `CLAUDE.md`. **Constraints:** `list_id` → `word_lists(id)`; unique
  `(list_id, session_index)`.
- `vocab_session_attempts` — one row per word drilled per session
  (`session_id`, `list_id`, `word`, `correct`, box before/after, the user's
  answer). **Constraints:** `session_id` → `vocab_sessions(id)`; `list_id`
  → `word_lists(id)`; composite `(list_id, word)` → `list_words(list_id, word)`.
- `error_events` — one row per unexpected server-side error (route,
  message, stack, jsonb context), written best-effort by
  `src/lib/server/logger.ts` from `src/hooks.server.ts`'s `handleError` hook
  (and directly from `claude-evaluate.ts` for Claude API failures). Exists
  because Vercel's own function-log retention is short and this repo has no
  linked Vercel CLI session — read recent rows with `npm run logs:errors`
  (`scripts/read-error-log.ts`) instead of the Vercel dashboard. No FKs.
- `conjugation_state` — for the conjugation-drills activity. One row per
  `(user_id, cell_id)`, `box` 0-4, `last_session` — same box/interval shape
  as `word_state`, but keyed by `cell_id` (the opaque `"wordClass:formId"`
  string from `src/lib/conjugation-forms.ts`'s `cellId()`, e.g.
  `"godan_mu:causative_passive_past"`) instead of `word`, and with no
  `list_id` at all. Unlike vocab drill's per-user authored lists,
  conjugation drills work off one shared word-class/form registry —
  `src/lib/conjugation-word-list.ts` and `conjugation-forms.ts`, static code
  data, not a table, since it never changes per-user. See
  `src/lib/conjugation-engine.ts`. **Constraints:** `user_id` → `users(id)`;
  unique `(user_id, cell_id)`. `cell_id` has no FK — the registry it names
  is code, not a table.
- `conjugation_sessions` — one row per conjugation-drill session (`user_id`,
  `session_index`, `started_at`, `completed_at`, `cells_drilled`).
  `session_index` is a per-user counter (there's no list to scope it to).
  **Constraints:** `user_id` → `users(id)`; unique `(user_id, session_index)`.
- `conjugation_session_attempts` — one row per cell drilled per session
  (`session_id`, `user_id`, `cell_id`, `word` — the specific word shown for
  this cell this attempt, since the word isn't part of the progress state
  itself — `correct`, box before/after, the user's answer, `attempts_used`
  1-3). `attempts_used` records the hint-then-retry-up-to-3 interaction from
  the design; grading is still based on the first attempt only.
  **Constraints:** `session_id` → `conjugation_sessions(id)`; `user_id` →
  `users(id)`. No FK on `cell_id` (same reason as `conjugation_state`), and
  **no FK on `word` either** — it's a free-text historical record of what
  was actually shown for that attempt, not tied to any registry table (see
  the migration-gotchas note below for why this matters).

### Migration gotchas: no FK here cascades

**None of the foreign keys above have `ON DELETE`/`ON UPDATE CASCADE`** —
every one is Postgres's default `NO ACTION`. This matters most for
`list_words`, since two other tables (`word_state`,
`vocab_session_attempts`) hold composite FKs into it on `(list_id, word)`,
not just a plain `list_id` FK:

- **Deleting a `list_words` row** fails with `violates foreign key
constraint ..._list_word_fkey` if any `word_state` or
  `vocab_session_attempts` row still has that exact `(list_id, word)` —
  delete those child rows first (order between the two children doesn't
  matter, only child-before-parent matters).
- **Renaming a word in place** (updating `list_words.word`, e.g. to fix a
  spelling) can't be done as a single `UPDATE`, and can't even be done as
  insert-new-row-then-repoint-then-delete-old-row at the _same_
  `frequency_rank`, because of the `(list_id, frequency_rank)` unique
  constraint above — the new row collides with the old one until the old
  one is gone. The working sequence is: insert the new spelling at a
  placeholder rank that can't collide (e.g. the negative of the real rank,
  since real ranks are always positive) → repoint `word_state`/
  `vocab_session_attempts` to the new spelling (now valid, since a
  `list_words` row for it exists) → delete the old spelling's row (now
  unreferenced) → update the new row's rank to the real value (now free).
  `scripts/scrub-master-list-cleanup.ts` is a worked, tested example of this
  exact dance — reuse its pattern rather than rediscovering it.
- This also means **a REMOVE-style cleanup of a word from a list requires
  deciding what happens to its `vocab_session_attempts` history** — you
  can't just leave it, since the FK forbids an orphaned reference. Either
  delete the history rows too, or don't remove the `list_words` row.

### Conjugation tables: no equivalent gotcha, checked and confirmed

**None of `conjugation_state`, `conjugation_sessions`, or
`conjugation_session_attempts` have any FK or unique constraint on word
text at all.** `conjugation_state` and `conjugation_session_attempts` key
on `cell_id` (`"wordClass:formId"`, e.g. `"godan_mu:causative_passive_past"`),
which has no FK to anything — the registry it names
(`conjugation-word-list.ts` + `conjugation-forms.ts`) is static code, not a
table. `conjugation_session_attempts.word` — the specific word actually
shown for that attempt — is a plain `not null text` column with **no FK at
all**, not even to `cell_id`'s (nonexistent) registry table.

Practical upshot: **removing or renaming an entry in
`conjugation-word-list.ts` needs no DB migration or scrub script.**
Progress (`conjugation_state`) is keyed on the class/form cell, not the
specific word, so it's completely unaffected by which words exist in the
static list. Historical `conjugation_session_attempts.word` values for a
since-removed word just sit there as an accurate record of what was shown
at the time — no FK forces a decision the way `vocab_session_attempts` did
for the vocab list.

## One-time data migrations, historical

These already ran, against real data, exactly once, and their scripts have
since been deleted — kept here only as a record of what happened and in
what order, not as something to re-run or copy as a template (the table
names below are the **pre-1.2.0** names; see the Schema section above for
current names).

- **0.1.0 cutover**: seeded a single global vocabulary/progress from
  `japanese-2000-most-frequent-words.md`/`vocab-state.md` into the
  (now-dropped) global `vocab_master` table, via `scripts/migrate-vocab-master.ts`
  and `scripts/migrate-vocab-state.ts`. Removed in 0.2.2 once `vocab_master`
  was dropped.
- **0.2.0 cutover** (multi-user/multi-list): added `users`/`word_lists`/
  `list_words` and scoped `word_state`/`sessions`/`session_attempts` by
  `list_id` instead of a single global vocabulary. Ran in three steps
  against a database that already had real 0.1.0 progress in it:
  1. `supabase/migrations/20260704000001_users_lists_additive.sql` — purely
     additive: created `users`/`word_lists`/`list_words`, and added nullable
     `list_id` columns (plus a surrogate `id` on `sessions`) to the existing
     tables. Safe to apply immediately; the app still ran against the old
     0.1.0 shape until the next steps happened.
  2. `scripts/migrate-legacy-user-list.ts` — created two users, gave each
     their own `japanese-2000-most-frequent-words.md` list seeded from the
     existing `vocab_master` table, and backfilled `list_id` (and
     `session_attempts.session_id`) on every existing `word_state`/
     `sessions`/`session_attempts` row onto the **primary** user's list —
     the **second** user got a fresh copy of the list with zero progress.
     Deleted in 2.0.1: it queried the pre-1.2.0 table names (`sessions`,
     `session_attempts`), so it would error immediately if run today, and
     there's no remaining legacy 0.1.0 data left for it to migrate anyway —
     keeping a script that's both unrunnable and stale-by-name around as a
     "template" risked someone copying broken table names into a future
     migration script rather than helping.
  3. `supabase/migrations/20260704000002_finalize_list_scoping.sql` —
     applied only after step 2 completed: enforced `list_id` not-null,
     swapped `sessions`' primary key from `session_index` to the surrogate
     `id`, replaced the old bare-`word` foreign keys with composite
     `(list_id, word)` ones, and dropped the now-unused `vocab_master` table.

Local dev (`npx supabase db reset`) applies all migrations to an empty
database, so none of this sequencing matters there — it only mattered for
the staging and production projects during the actual 0.2.0 cutover, which
is long past.

If a similar future cutover needs its own one-time migration script, follow
the _shape_ of the deleted `migrate-legacy-user-list.ts` (idempotent,
`--dry-run` support, usernames only ever passed as CLI args and never
hardcoded/committed) rather than resurrecting the file itself, since its
literal table/column references will be stale by the time anyone needs the
pattern again.
