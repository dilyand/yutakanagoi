-- scripts/wipe-shadowing-data.ts (the one-time reset for 3.1.0's no-chunking
-- pivot, see CHANGELOG) originally issued five separate DELETE requests,
-- one per table, with no transaction tying them together. If the app
-- created or completed a shadowing session between two of those requests
-- (a session/start or session/complete landing mid-wipe), that row could
-- survive in a table deleted after it, even though the run as a whole
-- reported success — the script's own "fully wiped" claim wouldn't
-- actually hold. Wrapping all five deletes in one function call gives
-- them Postgres's normal single-statement transaction semantics: either
-- every table ends up empty, or (on any error) none of them change at
-- all. A session created after this transaction commits is simply new
-- data, not a survivor of the wipe — correctly untouched.
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
