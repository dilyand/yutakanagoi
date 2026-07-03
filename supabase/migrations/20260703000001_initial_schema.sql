-- Initial schema for the yutakanagoi drill app.
-- Mirrors the data model documented in CLAUDE.md (vocab-master.md / vocab-state.md),
-- migrated to Supabase Postgres. See scripts/migrate-vocab-master.ts and
-- scripts/migrate-vocab-state.ts (added in a later issue) for the one-time data load.

-- The full target vocabulary list. Rarely changes. Source of truth for what words exist.
create table vocab_master (
  id             bigint generated always as identity primary key,
  word           text not null unique,
  frequency_rank integer not null unique
);

-- Per-word drill state. Only words that have been drilled at least once get a row here —
-- mirrors vocab-state.md's "words not yet in this file are implicitly not yet introduced".
create table word_state (
  id            bigint generated always as identity primary key,
  word          text not null references vocab_master (word) unique,
  box           smallint not null default 0 check (box between 0 and 4),
  last_session  integer not null,
  updated_at    timestamptz not null default now()
);

-- Global session counter + bookkeeping. session_index lives here (queryable/auditable)
-- rather than as a loose scalar, unlike the markdown file's "session_index: <integer>" header.
create table sessions (
  session_index integer primary key,
  started_at    timestamptz not null default now(),
  completed_at  timestamptz,
  words_drilled integer,
  notes         text
);

-- Per-attempt log. The markdown-driven design deliberately omitted this ("no timestamps,
-- no per-attempt history"); added here since storage is trivial at this scale and it
-- unlocks reviewing past mistakes / tuning intervals later.
create table session_attempts (
  id            bigint generated always as identity primary key,
  session_index integer not null references sessions (session_index),
  word          text not null references vocab_master (word),
  was_new_word  boolean not null,
  correct       boolean not null,
  box_before    smallint not null check (box_before between 0 and 4),
  box_after     smallint not null check (box_after between 0 and 4),
  user_answer   text,
  created_at    timestamptz not null default now()
);

create index session_attempts_session_index_idx on session_attempts (session_index);
create index session_attempts_word_idx on session_attempts (word);
