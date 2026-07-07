-- 2.0.0: conjugation drills, yutakanagoi's second activity.
--
-- Unlike vocab drill's word_state/vocab_sessions/vocab_session_attempts,
-- these tables carry no list_id: conjugation drills work off one shared
-- word-class/form registry (src/lib/conjugation-word-list.ts +
-- conjugation-forms.ts, static code data, not a table — it never changes
-- per-user, so there's nothing here to migrate a schema for), not per-user
-- authored lists like vocab. Progress is tracked per (user_id, cell_id),
-- where cell_id is the opaque "wordClass:formId" string from
-- src/lib/conjugation-forms.ts's cellId() helper (e.g.
-- "godan_mu:causative_passive_past") — src/lib/drill-algorithm.ts's
-- selectDrillWords/applyOutcome/pickDueWordsRoundRobin are reused unmodified
-- against this cell_id, since they already treat "word" as an opaque id.

create table conjugation_state (
  id            bigint generated always as identity primary key,
  user_id       bigint not null references users (id),
  cell_id       text not null,
  box           smallint not null default 0 check (box between 0 and 4),
  last_session  integer not null,
  updated_at    timestamptz not null default now(),
  unique (user_id, cell_id)
);

create table conjugation_sessions (
  id             bigint generated always as identity primary key,
  user_id        bigint not null references users (id),
  session_index  integer not null,
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  cells_drilled  integer,
  unique (user_id, session_index)
);

-- attempts_used (1-3) records the "hint, retry up to 3 times, then reveal"
-- interaction from the conjugation-drills design — grading itself is still
-- based on the first attempt only, this column is purely for later analysis
-- (e.g. "which cells take multiple tries most often").
create table conjugation_session_attempts (
  id            bigint generated always as identity primary key,
  session_id    bigint not null references conjugation_sessions (id),
  user_id       bigint not null references users (id),
  cell_id       text not null,
  word          text not null,
  was_new_cell  boolean not null,
  correct       boolean not null,
  box_before    smallint not null check (box_before between 0 and 4),
  box_after     smallint not null check (box_after between 0 and 4),
  user_answer   text,
  attempts_used smallint not null default 1,
  created_at    timestamptz not null default now()
);

create index conjugation_session_attempts_session_id_idx on conjugation_session_attempts (session_id);
create index conjugation_session_attempts_user_cell_idx on conjugation_session_attempts (user_id, cell_id);

-- Same access model as every other table (see 20260703000001_initial_schema.sql):
-- server-side service_role only, RLS enabled with no policies.
grant select, insert, update, delete on conjugation_state, conjugation_sessions, conjugation_session_attempts
  to service_role;

alter table conjugation_state enable row level security;
alter table conjugation_sessions enable row level security;
alter table conjugation_session_attempts enable row level security;
