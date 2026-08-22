-- ingest:publish's re-publish path used to run the recording update, the
-- old chunk-row delete, and the new chunk-row insert as three separate
-- supabase-js calls. Uploading every new-version audio file before
-- touching the DB (see the app repo's history) closed the biggest risk
-- window, but the DB swap itself was still not atomic: if the insert
-- failed after the delete succeeded, the recording was left with zero
-- live chunks until a manual re-run. This function wraps all three writes
-- in one transaction so that never happens — either the whole swap lands,
-- or none of it does and the previous chunking_version stays fully live.
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

grant execute on function publish_shadowing_recording(
	bigint, text, integer, text, text, smallint, jsonb
) to service_role;
