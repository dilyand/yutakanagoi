-- CREATE FUNCTION grants EXECUTE to PUBLIC by default. The prior migration
-- (20260822000001) granted EXECUTE to service_role on top of that default
-- without ever revoking it — meaning PUBLIC (which every Postgres role,
-- including Supabase's anon/authenticated API roles, is implicitly a
-- member of for privilege purposes) could still call
-- publish_shadowing_recording directly via Supabase's REST RPC endpoint.
-- Because the function is SECURITY DEFINER, that call would run with the
-- function owner's privileges — bypassing RLS entirely — letting any
-- anon/authenticated caller overwrite any user's recording by supplying an
-- arbitrary p_recording_id and p_chunk_rows. Revoke the default grant
-- explicitly; service_role (the only caller this function is meant for,
-- and the only one ever actually used — see ingest/cli/publish.ts) keeps
-- its own grant from the prior migration.
revoke execute on function publish_shadowing_recording(
	bigint, text, integer, text, text, smallint, jsonb
) from public;

revoke execute on function publish_shadowing_recording(
	bigint, text, integer, text, text, smallint, jsonb
) from anon, authenticated;
