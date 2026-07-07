# Supabase schema

Versioned SQL migrations for the drill app's data store live in
`supabase/migrations/`. This directory was set up with `supabase init`
(Supabase CLI); `supabase/config.toml` configures the local dev stack.

## Environments

There are two real (non-local) Supabase projects:

- **Production** — the real vocab list and drill progress. Vercel's
  Production environment variables point here.
- **Staging/preview** — a throwaway project seeded with a copy of the same
  vocab list and progress, used so that testing a Preview deployment (e.g.
  installing it on a phone and playing through drill sessions) can never
  corrupt real progress. Vercel's Preview environment variables point here
  instead. If this project ever needs re-seeding (schema changes, fresh
  copy of progress), `link` the CLI to it and re-run the migration scripts
  below against it — same process as production, different project ref.

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

## One-time data migration, historical (japanese-2000-most-frequent-words.md / vocab-state.md → Supabase)

The 0.1.0 cutover seeded a single global vocabulary/progress from the
markdown files, via `scripts/migrate-vocab-master.ts` and
`scripts/migrate-vocab-state.ts`. Both scripts targeted the (now-dropped)
global `vocab_master` table, so they've been removed — this is what
`scripts/migrate-legacy-user-list.ts` (below) reads from at the 0.2.0
cutover, not something that needs re-running.

## Multi-user / multi-list migration (0.2.0)

0.2.0 adds `users`/`word_lists`/`list_words` and scopes `word_state` /
`sessions` / `session_attempts` by `list_id` instead of a single global
vocabulary. Because this needs to run against a database that may already
have real 0.1.0 progress in it, it's split into two migrations with a data
backfill script in between — **apply them in this exact order**:

1. **`supabase/migrations/20260704000001_users_lists_additive.sql`** — purely
   additive: creates `users`/`word_lists`/`list_words`, and adds nullable
   `list_id` columns (plus a surrogate `id` on `sessions`) to the existing
   tables. Safe to apply immediately; the app still runs against the old
   0.1.0 shape until the next steps happen.
2. **`scripts/add-user.ts`** (as needed) and
   **`scripts/migrate-legacy-user-list.ts`** — copy `.env.example` to `.env`
   and fill in `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`, then:

   ```sh
   npm run add-user -- <username>                                    # create additional users
   npm run migrate:legacy-user-list -- <primary-user> <second-user>  # --dry-run supported
   ```

   `migrate:legacy-user-list` creates (or reuses) the two given users, gives
   each their own `japanese-2000-most-frequent-words.md` list seeded from the
   existing `vocab_master` table, and backfills `list_id` (and
   `session_attempts.session_id`) on every existing `word_state`/`sessions`/
   `session_attempts` row onto the **primary** user's list — the **second**
   user gets a fresh copy of the list with zero progress. Usernames are only
   ever passed as CLI arguments and stored in the `users` table — never
   hardcoded in the script or written to a committed file. Safe to re-run.

3. **`supabase/migrations/20260704000002_finalize_list_scoping.sql`** —
   apply only after step 2 has completed: enforces `list_id` not-null,
   swaps `sessions`' primary key from `session_index` to the surrogate `id`,
   replaces the old bare-`word` foreign keys with composite
   `(list_id, word)` ones, and drops the now-unused `vocab_master` table.
   Applying this before the backfill script has run will fail its not-null
   constraints.

Local dev (`npx supabase db reset`) applies all migrations to an empty
database, so this ordering only matters for a database that already has
0.1.0 data — i.e. the staging and production projects during the 0.2.0
cutover.

## Schema

- `users` — one row per person using the app (`username`, unique). Created
  out-of-band via `scripts/add-user.ts`, never through the app itself.
- `word_lists` — one row per uploaded/migrated word list (`user_id`, `name`).
  Private per user; `name` is always the uploaded filename, unique per user.
- `list_words` — one row per word in a list (`list_id`, `word`,
  `frequency_rank`). Replaces the 0.1.0-era global `vocab_master`.
- `word_state` — one row per word that's been drilled at least once within a
  list (`list_id`, `word`, `box` 0-4, `last_session`). Progress is scoped to
  `(list_id, word)`, not shared across lists or users.
- `vocab_sessions` — one row per drill session (`list_id`, `session_index`,
  `started_at`, `completed_at`, `words_drilled`). `session_index` is a
  per-list counter (not global) — the due-word interval algorithm measures
  "sessions since last seen" for one list's own history, so mixing counters
  across lists would give wrong due-dates. See `src/lib/drill-algorithm.ts`
  and `CLAUDE.md`. Named `sessions` before 1.2.0 — renamed since the bare
  name carried no vocab-specific token, unlike `word_state`/`word_lists`/
  `list_words`.
- `vocab_session_attempts` — one row per word drilled per session
  (`session_id`, `list_id`, `word`, `correct`, box before/after, the user's
  answer). Named `session_attempts` before 1.2.0, renamed alongside
  `vocab_sessions` for the same reason.
- `error_events` — added in 0.6.0. One row per unexpected server-side error
  (route, message, stack, jsonb context), written best-effort by
  `src/lib/server/logger.ts` from `src/hooks.server.ts`'s `handleError` hook
  (and directly from `claude-evaluate.ts` for Claude API failures). Exists
  because Vercel's own function-log retention is short and this repo has no
  linked Vercel CLI session — read recent rows with `npm run logs:errors`
  (`scripts/read-error-log.ts`) instead of the Vercel dashboard.
- `conjugation_state` — added in 2.0.0, for the conjugation-drills activity.
  One row per `(user_id, cell_id)`, `box` 0-4, `last_session` — same
  box/interval shape as `word_state`, but keyed by `cell_id` (the opaque
  `"wordClass:formId"` string from `src/lib/conjugation-forms.ts`'s
  `cellId()`, e.g. `"godan_mu:causative_passive_past"`) instead of `word`,
  and with no `list_id` at all. Unlike vocab drill's per-user authored
  lists, conjugation drills work off one shared word-class/form registry —
  `src/lib/conjugation-word-list.ts` and `conjugation-forms.ts`, static code
  data, not a table, since it never changes per-user. See
  `src/lib/conjugation-engine.ts`.
- `conjugation_sessions` — one row per conjugation-drill session (`user_id`,
  `session_index`, `started_at`, `completed_at`, `cells_drilled`).
  `session_index` is a per-user counter (there's no list to scope it to).
- `conjugation_session_attempts` — one row per cell drilled per session
  (`session_id`, `user_id`, `cell_id`, `word` — the specific word shown for
  this cell this attempt, since the word isn't part of the progress state
  itself — `correct`, box before/after, the user's answer, `attempts_used`
  1-3). `attempts_used` records the hint-then-retry-up-to-3 interaction from
  the design; grading is still based on the first attempt only.
