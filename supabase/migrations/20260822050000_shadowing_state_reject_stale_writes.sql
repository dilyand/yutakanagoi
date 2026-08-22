-- Round 17's session/start fix stops two requests racing to insert the
-- *same* session_index, but a sequential case still gets through: session N
-- can be started and left incomplete (a tab left open mid-drill), then a
-- second tab starts session N+1 — a clean insert, no collision, since N+1
-- doesn't conflict with N. Both sessions were built from the same progress
-- snapshot (read before either completed). If N+1 finishes first and N
-- finishes later, N's completion would overwrite N+1's already-recorded,
-- newer box/last_session values with older ones computed from the stale
-- snapshot. Blocking every overlapping session outright was considered and
-- rejected: a user who abandons a session (closes the tab without
-- completing or cancelling) would then be permanently locked out of
-- starting a new one, with no expiry mechanism to recover from that.
--
-- Guarding the write itself, atomically, is narrower and carries no such
-- lockout risk: within one session/complete batch every row's last_session
-- equals that session's own session_index (see
-- src/lib/shadowing/rating.ts's applyShadowingOutcome), so comparing the
-- incoming last_session against what's already stored is exactly "is this
-- write coming from a more recent session than the one currently recorded
-- for this chunk." A plain supabase-js .upsert() can't express a
-- conditional ON CONFLICT ... WHERE clause, hence this RPC — matching the
-- publish_shadowing_recording precedent for a write that needs one atomic
-- statement rather than a race-prone read-then-write from application code.
create or replace function upsert_shadowing_chunk_states(
	p_user_id bigint,
	p_rows jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	insert into shadowing_state (user_id, chunk_id, box, last_session, box4_streak)
	select
		p_user_id,
		elem ->> 'chunk_id',
		(elem ->> 'box')::smallint,
		(elem ->> 'last_session')::integer,
		(elem ->> 'box4_streak')::smallint
	from jsonb_array_elements(p_rows) as elem
	on conflict (user_id, chunk_id) do update
	set box = excluded.box,
		last_session = excluded.last_session,
		box4_streak = excluded.box4_streak
	where excluded.last_session > shadowing_state.last_session;
end;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default — revoke it
-- immediately (see 20260822010000's comment for why this matters: PUBLIC
-- includes Supabase's anon/authenticated API roles, and this function is
-- SECURITY DEFINER, so leaving the default grant would let any
-- anon/authenticated caller invoke it directly via the REST RPC endpoint
-- and write arbitrary shadowing_state rows under any p_user_id).
revoke execute on function upsert_shadowing_chunk_states(bigint, jsonb) from public;
revoke execute on function upsert_shadowing_chunk_states(bigint, jsonb) from anon, authenticated;
grant execute on function upsert_shadowing_chunk_states(bigint, jsonb) to service_role;
