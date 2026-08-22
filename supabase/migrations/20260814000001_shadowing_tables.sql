-- 3.0.0: shadowing drill, yutakanagoi's third activity.
--
-- Unlike conjugation drill's shared registry, shadowing content is per-user
-- (like vocab drill's word lists) — each user's shadowing library is their
-- own audio, ingested out-of-band by the separate `ingest/` tool (not part
-- of this app, see repo root CLAUDE.md). This migration only creates the
-- schema both the ingest tool and the app read/write; it can be applied to
-- staging/production before any app code that queries these tables merges,
-- since it's purely additive.

create table shadowing_recordings (
  id                bigint generated always as identity primary key,
  user_id           bigint not null references users (id),
  slug              text not null,
  recorded_on       date,
  duration_ms       integer not null,
  source_audio_path text not null,
  transcript        text not null,
  transcript_source text not null check (transcript_source in ('supplied', 'asr')),
  chunking_version  smallint not null default 1,
  ingested_at       timestamptz not null default now(),
  unique (user_id, slug)
);

-- chunk_id embeds chunking_version ('<slug>:<version>:<NN>') so a re-chunk
-- mints new ids rather than silently re-pointing shadowing_state at audio
-- whose boundaries moved. verified_at is the serving gate: the app only
-- ever selects rows where it's set, so nothing that failed the ingest
-- tool's verification checks (content-match, fade, distinctness, no-cut-on-
-- attack, coverage — see ingest/verify.ts) can reach a session even if its
-- row somehow got inserted. flagged_at/flag_note are set by the in-app Flag
-- button, and exclude a chunk from rotation until a human looks at it.
create table shadowing_chunks (
  id           bigint generated always as identity primary key,
  recording_id bigint not null references shadowing_recordings (id),
  user_id      bigint not null references users (id),
  chunk_index  smallint not null,
  chunk_id     text not null,
  audio_path   text not null,
  start_ms     integer not null,
  duration_ms  integer not null,
  transcript   text not null,
  kana         text not null,
  translation  text not null,
  verified_at  timestamptz,
  flagged_at   timestamptz,
  flag_note    text,
  unique (recording_id, chunk_index),
  unique (user_id, chunk_id)
);

create index shadowing_chunks_recording_id_idx on shadowing_chunks (recording_id);

-- Same box/interval/streak shape as word_state/conjugation_state — see
-- src/lib/drill-algorithm.ts. Deliberately NO FK from chunk_id to
-- shadowing_chunks, even though (unlike conjugation's static registry) the
-- registry here is a real table: the merge/split heuristic in
-- ingest/chunk-planner.ts is explicitly an untested guess, so re-chunking a
-- recording is expected to happen and would otherwise require the same
-- four-step placeholder-rank dance list_words renames need (see
-- supabase/README.md's migration gotchas). Accepted downside: progress for
-- a recording's chunks resets when it's re-chunked, since chunk_id changes
-- with chunking_version — the boundaries changed, so the item changed.
create table shadowing_state (
  id           bigint generated always as identity primary key,
  user_id      bigint not null references users (id),
  chunk_id     text not null,
  box          smallint not null default 0 check (box between 0 and 4),
  last_session integer not null,
  box4_streak  smallint not null default 0,
  updated_at   timestamptz not null default now(),
  unique (user_id, chunk_id)
);

create table shadowing_sessions (
  id             bigint generated always as identity primary key,
  user_id        bigint not null references users (id),
  session_index  integer not null,
  started_at     timestamptz not null default now(),
  completed_at   timestamptz,
  chunks_drilled integer,
  unique (user_id, session_index)
);

-- rating is derived from how far up the hint ladder the user climbed before
-- advancing (see src/lib/shadowing/rating.ts), not self-reported. replays
-- doesn't affect grading (free repetition is the point of shadowing
-- practice) but is recorded as the most interesting behavioral signal this
-- activity produces.
create table shadowing_session_attempts (
  id            bigint generated always as identity primary key,
  session_id    bigint not null references shadowing_sessions (id),
  user_id       bigint not null references users (id),
  chunk_id      text not null,
  was_new_chunk boolean not null,
  hint_level    smallint not null check (hint_level between 0 and 3),
  rating        text not null check (rating in ('easy', 'good', 'hard', 'very_hard')),
  replays       smallint not null default 0,
  box_before    smallint not null check (box_before between 0 and 4),
  box_after     smallint not null check (box_after between 0 and 4),
  created_at    timestamptz not null default now()
);

create index shadowing_session_attempts_session_id_idx on shadowing_session_attempts (session_id);
create index shadowing_session_attempts_user_chunk_idx on shadowing_session_attempts (user_id, chunk_id);

-- Same access model as every other table: server-side service_role only,
-- RLS enabled with no policies.
grant select, insert, update, delete on
  shadowing_recordings, shadowing_chunks, shadowing_state,
  shadowing_sessions, shadowing_session_attempts
  to service_role;

alter table shadowing_recordings enable row level security;
alter table shadowing_chunks enable row level security;
alter table shadowing_state enable row level security;
alter table shadowing_sessions enable row level security;
alter table shadowing_session_attempts enable row level security;

-- Storage: private bucket for shadowing audio, service-role only (no RLS
-- policies — this app has no Supabase Auth, so auth.uid()-based policies
-- don't apply; access control happens server-side the same way DB access
-- does, via signed URLs minted after the session cookie is verified).
-- Path scheme: users/<user_id>/<slug>/v<chunking_version>/source.<ext> (full
-- recording, extension matching the ingested file — m4a/mp3/wav/ogg — kept
-- for re-chunking) and
-- users/<user_id>/<slug>/v<chunking_version>/chunk-NN.m4a (version in the
-- path for both, not just the chunk_id, so a re-chunk's uploads — source
-- included — never touch audio a live shadowing_chunks row or the live
-- recording row's source_audio_path still points at).
insert into storage.buckets (id, name, public, file_size_limit)
values ('shadowing-audio', 'shadowing-audio', false, 52428800)
on conflict (id) do nothing;
