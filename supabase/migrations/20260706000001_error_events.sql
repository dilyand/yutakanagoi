-- 0.6.0: a place to persist unexpected server-side errors (Supabase/Anthropic
-- failures, anything hitting hooks.server.ts's handleError), since Vercel's
-- own function-log retention is short and this repo has no linked Vercel CLI
-- session. Written best-effort by src/lib/server/logger.ts and read via
-- `npm run logs:errors` (scripts/read-error-log.ts) — see supabase/README.md.

create table error_events (
  id         bigint generated always as identity primary key,
  occurred_at timestamptz not null default now(),
  route      text,
  message    text not null,
  stack      text,
  context    jsonb,
  created_at timestamptz not null default now()
);

create index error_events_occurred_at_idx on error_events (occurred_at desc);

grant usage on schema public to service_role;
grant select, insert, update, delete on error_events to service_role;
grant usage, select on all sequences in schema public to service_role;

alter table error_events enable row level security;
