# Supabase schema

Versioned SQL migrations for the drill app's data store live in
`supabase/migrations/`. This directory was set up with `supabase init`
(Supabase CLI); `supabase/config.toml` configures the local dev stack.

## Applying migrations

**Local development** (requires Docker):

```sh
npx supabase start   # spins up local Postgres + stack, applies all migrations
npx supabase stop    # tears it down
npx supabase db reset  # drops and re-applies all migrations from scratch
```

**Against a real Supabase project** (once one exists — see the PWA migration
plan, issue #10 for cutover):

```sh
npx supabase link --project-ref <project-ref>
npx supabase db push
```

## Schema

- `vocab_master` — the full target vocabulary list (word, frequency_rank).
  Seeded once from `vocab-master.md` by a migration script (added in a later
  issue); rarely changes after that.
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
