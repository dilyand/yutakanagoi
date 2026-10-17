-- Persisted daily usage counters for target practice's cost guardrails — a
-- circuit breaker against a bug or runaway loop eating API credit, not
-- billing. src/lib/server/rate-limit.ts is per-instance and resets on cold
-- start, so it stays only a per-IP burst guard; the real caps need a counter
-- that survives both.
--
-- One row per (user, UTC day). `day` is computed inside Postgres rather than
-- passed in, so a skewed server clock can't shift a user's day boundary.
create table target_practice_usage (
  user_id       bigint not null references users (id),
  day           date not null,
  sessions      integer not null default 0,
  lookups       integer not null default 0,
  input_tokens  bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, day)
);

alter table target_practice_usage enable row level security;

-- Check-and-increment as one step, so two tabs can't both read "4 of 5" and
-- both proceed. The UPDATE takes the row lock and, under READ COMMITTED,
-- re-evaluates its WHERE against the latest committed row after waiting, so
-- concurrent reservations serialise: exactly cap-many succeed.
--
-- p_kind picks which counter this call consumes:
--   'session'  — a generation start (stage 1 only; stage 2, retries and
--                "Resume" are not new sessions)
--   'lookup'   — a candidate or card call
--   'ceiling'  — consumes no counter, only checks the output-token ceiling
--                (stage 2, retries, fallback grading)
-- Every kind also requires output_tokens < p_output_ceiling: the ceiling is
-- the real backstop, since it also catches loops that never touch a counter.
-- Returns false when blocked. There is deliberately no refund on failure — a
-- refund would weaken the breaker in exactly the runaway case.
--
-- Same access model as create_word_list (20260823000001): security definer,
-- execute granted to service_role only, grant/revoke in this same migration
-- so there is never a window where anon/authenticated could call it.
create or replace function reserve_target_practice_usage(
	p_user_id bigint,
	p_kind text,
	p_session_cap integer,
	p_lookup_cap integer,
	p_output_ceiling bigint
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
	v_day date := (now() at time zone 'utc')::date;
begin
	if p_kind not in ('session', 'lookup', 'ceiling') then
		raise exception 'invalid usage kind: %', p_kind;
	end if;

	insert into target_practice_usage (user_id, day)
	values (p_user_id, v_day)
	on conflict (user_id, day) do nothing;

	update target_practice_usage
	set sessions = sessions + (p_kind = 'session')::int,
	    lookups  = lookups  + (p_kind = 'lookup')::int
	where user_id = p_user_id
	  and day = v_day
	  and output_tokens < p_output_ceiling
	  and (p_kind <> 'session' or sessions < p_session_cap)
	  and (p_kind <> 'lookup'  or lookups  < p_lookup_cap);

	return found;
end;
$$;

revoke execute on function reserve_target_practice_usage(bigint, text, integer, integer, bigint) from public;
revoke execute on function reserve_target_practice_usage(bigint, text, integer, integer, bigint) from anon, authenticated;
grant execute on function reserve_target_practice_usage(bigint, text, integer, integer, bigint) to service_role;

-- Adds a finished call's token usage to today's row. Additive upsert, so
-- parallel calls (stage 1 + stage 2) can both record without losing updates.
create or replace function record_target_practice_tokens(
	p_user_id bigint,
	p_input_tokens bigint,
	p_output_tokens bigint
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
	v_day date := (now() at time zone 'utc')::date;
begin
	if p_input_tokens < 0 or p_output_tokens < 0 then
		raise exception 'token counts must be non-negative';
	end if;

	insert into target_practice_usage (user_id, day, input_tokens, output_tokens)
	values (p_user_id, v_day, p_input_tokens, p_output_tokens)
	on conflict (user_id, day) do update
	set input_tokens  = target_practice_usage.input_tokens  + excluded.input_tokens,
	    output_tokens = target_practice_usage.output_tokens + excluded.output_tokens;
end;
$$;

revoke execute on function record_target_practice_tokens(bigint, bigint, bigint) from public;
revoke execute on function record_target_practice_tokens(bigint, bigint, bigint) from anon, authenticated;
grant execute on function record_target_practice_tokens(bigint, bigint, bigint) to service_role;
