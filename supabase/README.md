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

## One-time data migration (vocab-master.md / vocab-state.md → Supabase)

Copy `.env.example` to `.env` and fill in `SUPABASE_URL` /
`SUPABASE_SERVICE_ROLE_KEY` (from `npx supabase start` for local dev, or a
project's API settings for anything else), then:

```sh
npm run migrate:vocab-master   # seeds vocab_master from vocab-master.md
npm run migrate:vocab-state    # seeds sessions + word_state from vocab-state.md
```

Run `migrate:vocab-master` first — `migrate:vocab-state` checks that every
word it needs already exists in `vocab_master` and fails fast with a clear
error otherwise. Both scripts support `--dry-run` (prints what would be
written without touching the database) and are safe to re-run (upserts).

## Schema

- `vocab_master` — the full target vocabulary list (word, frequency_rank).
  Seeded once from `vocab-master.md` (see migration scripts above); rarely
  changes after that.
- `word_state` — one row per word that's been drilled at least once (box
  0-4, last_session). Direct analog of `vocab-state.md`'s table.
- `sessions` — one row per drill session, with `session_index` as the
  primary key (replaces the markdown file's loose `session_index: <n>`
  header with a queryable/auditable log).
- `session_attempts` — one row per word drilled per session (word, correct,
  box before/after, the user's answer). Richer history than the markdown
  design intentionally kept ("no per-attempt history") — kept here since
  storage is trivial at this scale and it enables reviewing past mistakes
  later.
