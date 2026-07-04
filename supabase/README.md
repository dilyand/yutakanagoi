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
- `sessions` — one row per drill session (`list_id`, `session_index`,
  `started_at`, `completed_at`, `words_drilled`). `session_index` is a
  per-list counter (not global) — the due-word interval algorithm measures
  "sessions since last seen" for one list's own history, so mixing counters
  across lists would give wrong due-dates. See `src/lib/drill-algorithm.ts`
  and `CLAUDE.md`.
- `session_attempts` — one row per word drilled per session (`session_id`,
  `list_id`, `word`, `correct`, box before/after, the user's answer).
