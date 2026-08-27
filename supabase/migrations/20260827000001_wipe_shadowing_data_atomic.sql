-- scripts/wipe-shadowing-data.ts (the one-time reset for 3.1.0's no-chunking
-- pivot, see CHANGELOG) originally issued five separate DELETE requests,
-- one per table, with no transaction tying them together. If the app
-- created or completed a shadowing session between two of those requests
-- (a session/start or session/complete landing mid-wipe), that row could
-- survive in a table deleted after it, even though the run as a whole
-- reported success. Wrapping all five deletes in one function call closes
-- that specific gap: either every table ends up empty, or (on any error)
-- none of them change at all.
--
-- What this does NOT do: serialize the wipe against the live app. A plain
-- DELETE takes row-level locks, not a table-level lock that would block a
-- concurrent INSERT — a session/start or session/complete request already
-- in flight when this transaction begins can still commit its own insert/
-- upsert at any point during or after this transaction, surviving the
-- wipe even though every table was genuinely empty at the instant this
-- function's DELETEs ran. Closing that fully would mean either an actual
-- maintenance-mode write-lock shared with every shadowing-table mutation
-- path (session/start, session/complete, the flag endpoint — a
-- meaningfully bigger change than this one-time script warrants) or
-- simply not having live traffic during the reset. scripts/
-- wipe-shadowing-data.ts's own console output says this explicitly; this
-- migration only guarantees the piece it actually can — the five deletes
-- landing together or not at all.
create or replace function wipe_shadowing_data() returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_session_attempts bigint;
	v_sessions bigint;
	v_state bigint;
	v_chunks bigint;
	v_recordings bigint;
begin
	-- Supabase's local/hosted Postgres runs with a "DELETE requires a WHERE
	-- clause" safety guard (caught running this for real against the local
	-- stack) — `where id > 0` is a real, always-true predicate given every
	-- id here is a `bigint generated always as identity` starting at 1, so
	-- it satisfies the guard without changing what gets deleted.
	delete from shadowing_session_attempts where id > 0;
	get diagnostics v_session_attempts = row_count;

	delete from shadowing_sessions where id > 0;
	get diagnostics v_sessions = row_count;

	delete from shadowing_state where id > 0;
	get diagnostics v_state = row_count;

	delete from shadowing_chunks where id > 0;
	get diagnostics v_chunks = row_count;

	delete from shadowing_recordings where id > 0;
	get diagnostics v_recordings = row_count;

	return jsonb_build_object(
		'shadowing_session_attempts', v_session_attempts,
		'shadowing_sessions', v_sessions,
		'shadowing_state', v_state,
		'shadowing_chunks', v_chunks,
		'shadowing_recordings', v_recordings
	);
end;
$$;

-- CREATE FUNCTION grants EXECUTE to PUBLIC by default — revoke it
-- immediately, in this same migration, rather than in a follow-up (see
-- 20260822010000's comment for why a gap between grant and revoke matters:
-- PUBLIC includes Supabase's anon/authenticated API roles, and this
-- function is SECURITY DEFINER, so leaving the default grant would let
-- any anon/authenticated caller wipe every shadowing recording via the
-- REST RPC endpoint).
revoke execute on function wipe_shadowing_data() from public;
revoke execute on function wipe_shadowing_data() from anon, authenticated;
grant execute on function wipe_shadowing_data() to service_role;
