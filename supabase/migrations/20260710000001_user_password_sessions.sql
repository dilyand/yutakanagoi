-- Additive step of the 2.2.0 per-user-auth cutover (see supabase/README.md).
-- password_hash is nullable for now — set-password.ts backfills it for the
-- two existing users before a later, separate migration makes it NOT NULL.
-- Currently-deployed code references neither column below, so this is safe
-- to apply ahead of the code deploy.

alter table users add column password_hash text;

create table sessions (
	id bigserial primary key,
	user_id bigint not null references users (id),
	token_hash text not null unique,
	created_at timestamptz not null default now(),
	expires_at timestamptz not null
);

create index sessions_user_id_idx on sessions (user_id);

-- Same access model as every other table (see 20260703000001_initial_schema.sql):
-- server-side service_role only, RLS enabled with no policies.
grant select, insert, update, delete on sessions to service_role;
grant usage, select on all sequences in schema public to service_role;

alter table sessions enable row level security;
