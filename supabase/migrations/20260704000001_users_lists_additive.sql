-- 0.2.0 part 1: additive schema for multi-user + multiple word lists.
--
-- Adds users/word_lists/list_words and nullable list_id (and, on sessions, a
-- surrogate id) columns on the existing word_state/sessions/session_attempts
-- tables. Nothing here is dropped or made required yet, so this is safe to
-- apply to a database that already has 0.1.0 data in it.
--
-- Sequencing (see supabase/README.md): apply this migration, then run
-- scripts/migrate-legacy-user-list.ts to create users/lists and backfill
-- list_id (and sessions.id -> session_attempts.session_id) on every existing
-- row, then apply 20260704000002_finalize_list_scoping.sql to enforce the
-- final not-null/unique/FK constraints and drop the old global vocab_master
-- table. Applying part 2 before the backfill script has run will fail its
-- not-null constraints.

create table users (
  id         bigint generated always as identity primary key,
  username   text not null unique,
  created_at timestamptz not null default now()
);

create table word_lists (
  id         bigint generated always as identity primary key,
  user_id    bigint not null references users (id),
  name       text not null,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

-- Replaces the 0.1.0-era global vocab_master (same shape, list_id-scoped
-- instead of global). vocab_master itself is dropped in part 2.
create table list_words (
  id             bigint generated always as identity primary key,
  list_id        bigint not null references word_lists (id),
  word           text not null,
  frequency_rank integer not null,
  unique (list_id, word),
  unique (list_id, frequency_rank)
);

alter table word_state add column list_id bigint references word_lists (id);

-- session_index becomes a per-list counter rather than a single global one
-- (see CLAUDE.md's "Why session_index must become list-scoped"), so sessions
-- needs a surrogate id to be its primary key instead. No FK from
-- session_attempts.session_id yet — sessions.id isn't unique/PK until part 2.
alter table sessions add column id bigint generated always as identity;
alter table sessions add column list_id bigint references word_lists (id);

alter table session_attempts add column session_id bigint;
alter table session_attempts add column list_id bigint references word_lists (id);

grant usage on schema public to service_role;
grant select, insert, update, delete on users, word_lists, list_words to service_role;
grant usage, select on all sequences in schema public to service_role;

alter table users enable row level security;
alter table word_lists enable row level security;
alter table list_words enable row level security;
