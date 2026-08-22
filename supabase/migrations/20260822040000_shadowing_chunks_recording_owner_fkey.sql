-- shadowing_chunks.user_id (denormalized, so the serving repository can
-- authorize and query without a join — see supabase/README.md) and
-- recording_id were independently valid but never constrained to describe
-- the same owner. fetchChunkDetailsWithSignedUrls authorizes solely
-- against shadowing_chunks.user_id before signing that row's audio_path,
-- so a single malformed row (a future ingest bug, a manual edit) whose
-- user_id didn't match its recording's real owner could expose one user's
-- recording to another account. Nothing in the current ingest/cli/publish.ts
-- code path can actually produce this today — both the recording lookup
-- and every chunk row derive from the same userId within one command
-- invocation — but nothing at the schema level enforced it either.
--
-- Standard Postgres pattern for this: a composite unique key on the
-- parent (every row's own id+user_id is already unique, so this is
-- trivially satisfiable) plus a composite FK on the child against it.
alter table shadowing_recordings add constraint shadowing_recordings_id_user_id_key unique (id, user_id);

alter table shadowing_chunks add constraint shadowing_chunks_recording_owner_fkey
	foreign key (recording_id, user_id) references shadowing_recordings (id, user_id);
