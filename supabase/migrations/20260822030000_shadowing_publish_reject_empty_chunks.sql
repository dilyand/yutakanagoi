-- ingest:publish now rejects an empty chunks manifest before ever calling
-- this RPC (see ingest/cli/publish.ts), but the RPC itself never enforced
-- that its own contract — a complete, working chunk set — actually holds:
-- p_chunk_rows was never required to be non-empty, so an empty JSON array
-- would delete the current chunking_version's live chunks and then
-- successfully insert nothing. Defense in depth: this is the actual
-- transactional boundary, so it shouldn't rely solely on its one caller
-- getting this right.
--
-- CREATE OR REPLACE with an unchanged signature preserves the function's
-- existing grants (service_role only, PUBLIC revoked — see
-- 20260822010000_shadowing_publish_revoke_public_execute.sql), so that
-- migration doesn't need to be re-applied here.
create or replace function publish_shadowing_recording(
	p_recording_id bigint,
	p_source_audio_path text,
	p_duration_ms integer,
	p_transcript text,
	p_transcript_source text,
	p_chunking_version smallint,
	p_chunk_rows jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
	if p_chunk_rows is null or jsonb_array_length(p_chunk_rows) = 0 then
		raise exception 'publish_shadowing_recording: p_chunk_rows must be a non-empty array';
	end if;

	update shadowing_recordings
	set source_audio_path = p_source_audio_path,
		duration_ms = p_duration_ms,
		transcript = p_transcript,
		transcript_source = p_transcript_source,
		chunking_version = p_chunking_version,
		ingested_at = now()
	where id = p_recording_id;

	delete from shadowing_chunks where recording_id = p_recording_id;

	insert into shadowing_chunks (
		recording_id, user_id, chunk_index, chunk_id, audio_path,
		start_ms, duration_ms, transcript, kana, translation, verified_at
	)
	select
		p_recording_id,
		(elem ->> 'user_id')::bigint,
		(elem ->> 'chunk_index')::smallint,
		elem ->> 'chunk_id',
		elem ->> 'audio_path',
		(elem ->> 'start_ms')::integer,
		(elem ->> 'duration_ms')::integer,
		elem ->> 'transcript',
		elem ->> 'kana',
		elem ->> 'translation',
		now()
	from jsonb_array_elements(p_chunk_rows) as elem;
end;
$$;
