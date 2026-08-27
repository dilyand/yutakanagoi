import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, requireString, requireSafePathComponent } from '../args.ts';
import { transcodeForPlayback } from '../audio-tools.ts';
import { createAdminClient } from '../../scripts/lib/supabase-admin.ts';

const USAGE = `Usage: npm run ingest:publish -- --slug <slug> --user <username> [--dry-run]

Reads ingest/work/<user>/<slug>/transcript.json, checks "kana"/"translation"
are filled in, then uploads the source audio plus a transcoded
browser-compatible AAC/m4a playback copy to Supabase Storage and
inserts/updates the DB rows. A recording publishes as exactly one
shadowing_chunks row (the whole file). Re-publishing an existing
(user, slug) bumps chunking_version and replaces that row — progress on
the old version's chunk id is orphaned, not migrated (see
supabase/README.md's "Shadowing tables" section for why).`;

const args = parseArgs(process.argv.slice(2));
// Both values are used as filesystem path components below — validated
// beyond just non-empty so a value like "../other" or ".." can't navigate
// workDir outside the intended ingest/work/<user>/<slug> directory (which
// could otherwise publish the wrong manifest under another user/slug).
const slug = requireSafePathComponent(requireString(args, 'slug', USAGE), 'slug');
const username = requireSafePathComponent(requireString(args, 'user', USAGE), 'username');
const dryRun = args['dry-run'] === true;

const workDir = path.join(import.meta.dirname, '..', 'work', username, slug);
const transcriptPath = path.join(workDir, 'transcript.json');
if (!existsSync(transcriptPath)) {
	console.error(`No transcript.json at ${transcriptPath} — run ingest:transcribe first.`);
	process.exit(1);
}

interface TranscriptManifest {
	slug: string;
	user: string;
	sourceAudioPath: string;
	durationMs: number;
	transcript: string;
	transcriptSource: 'supplied' | 'asr';
	kana: string;
	translation: string;
}

const manifest: TranscriptManifest = JSON.parse(readFileSync(transcriptPath, 'utf8'));

// transcript.json is hand-edited between ingest:transcribe and here (see
// PROMPT.md step 2) — nothing re-validates its shape after that edit, so a
// slipped field (deleted, emptied, or mistyped by hand) must be caught
// here rather than discovered downstream as a raw Storage/DB error, or
// worse, as a "verified" drill item that's actually empty or unplayable.
// transcriptSource is the one field the DB schema's own CHECK constraint
// already rejects outright — checked here anyway for a clearer, earlier
// message instead of a raw Postgres constraint-violation error.
const manifestErrors: string[] = [];
if (typeof manifest.transcript !== 'string' || manifest.transcript.trim() === '') {
	manifestErrors.push('"transcript" is missing or empty');
}
if (
	typeof manifest.durationMs !== 'number' ||
	!Number.isFinite(manifest.durationMs) ||
	manifest.durationMs <= 0
) {
	manifestErrors.push('"durationMs" is missing or not a positive number');
}
if (manifest.transcriptSource !== 'supplied' && manifest.transcriptSource !== 'asr') {
	manifestErrors.push('"transcriptSource" must be "supplied" or "asr"');
}
if (typeof manifest.sourceAudioPath !== 'string' || manifest.sourceAudioPath.trim() === '') {
	manifestErrors.push('"sourceAudioPath" is missing or empty');
}
if (typeof manifest.kana !== 'string' || manifest.kana.trim() === '') {
	manifestErrors.push('"kana" is missing or empty — fill it in first, see PROMPT.md');
}
if (typeof manifest.translation !== 'string' || manifest.translation.trim() === '') {
	manifestErrors.push('"translation" is missing or empty — fill it in first, see PROMPT.md');
}
if (manifestErrors.length > 0) {
	console.error(`transcript.json failed validation:\n  - ${manifestErrors.join('\n  - ')}`);
	process.exit(1);
}

const supabase = createAdminClient();
const { data: user, error: userError } = await supabase
	.from('users')
	.select('id')
	.eq('username', username)
	.maybeSingle();
if (userError) {
	console.error('Failed to look up user:', userError.message);
	process.exit(1);
}
if (!user) {
	console.error(`No user named "${username}".`);
	process.exit(1);
}
const userId: number = user.id;

const { data: existingRecording, error: existingError } = await supabase
	.from('shadowing_recordings')
	.select('id, chunking_version')
	.eq('user_id', userId)
	.eq('slug', slug)
	.maybeSingle();
if (existingError) {
	console.error('Failed to look up existing recording:', existingError.message);
	process.exit(1);
}
// "chunking_version" is a leftover name from when this column tracked a
// real re-chunk — kept as-is rather than renamed (a rename would need a
// migration this no-schema-break pivot deliberately avoids, see
// supabase/README.md). It still functions the same way here: a plain
// publish-generation counter, bumped on every re-publish of this slug.
const chunkingVersion = existingRecording ? existingRecording.chunking_version + 1 : 1;

const sourceExt = path.extname(manifest.sourceAudioPath) || '.m4a';
// Versioned, not a fixed unversioned path — an earlier version always
// wrote to the same "source.<ext>" path with upsert:true, which
// overwrote the currently-retained source immediately, before the DB
// swap even ran. A later failure then left the previous version's
// recording/chunk still fully live, but its archival source silently
// replaced by the new (possibly bad) one. Versioning means this upload
// can never touch anything the current live version depends on.
const sourceStoragePath = `users/${userId}/${slug}/v${chunkingVersion}/source${sourceExt}`;
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
	'.m4a': 'audio/mp4',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.ogg': 'audio/ogg'
};
const sourceContentType = CONTENT_TYPE_BY_EXT[sourceExt] ?? 'application/octet-stream';
// A second, separate object from the archival source above — the source
// is whatever container/codec ffmpeg accepted at ingest:transcribe time
// (m4a/mp3/wav/ogg/etc.), and not every one of those decodes in every
// browser this app supports (Safari has no Ogg/Vorbis support, notably).
// AAC-in-m4a is universally supported, so the served audio_path always
// points at this transcoded copy instead of the raw upload — the same
// guarantee the pre-3.1.0 chunk-cutting pipeline's per-chunk encode step
// used to provide.
const playbackPath = path.join(workDir, 'playback.m4a');
const playbackStoragePath = `users/${userId}/${slug}/v${chunkingVersion}/playback.m4a`;

console.log(
	existingRecording
		? `Re-publishing "${slug}" for ${username} — bumping to chunking_version ${chunkingVersion}.`
		: `Publishing "${slug}" for ${username} — chunking_version ${chunkingVersion}.`
);

if (dryRun) {
	console.log(`[dry-run] Would upload source to ${sourceStoragePath}`);
	console.log(`[dry-run] Would transcode and upload playback copy to ${playbackStoragePath}`);
	console.log(
		'[dry-run] Would insert/update shadowing_recordings and insert one shadowing_chunks row (the whole recording). No changes made.'
	);
	process.exit(0);
}

// Upload BEFORE touching any DB row. On a re-publish this matters: the
// new chunking_version's storage paths never collide with the currently-
// live version's (the version number is in the path), so nothing here
// can clobber what's currently served. Staging the files first means a
// Storage failure (network, a bad file) leaves the previous version's
// recording and chunk rows completely untouched — the DB swap below only
// runs once both new files are safely uploaded.
console.log(`Uploading source audio to ${sourceStoragePath}...`);
const sourceBytes = readFileSync(manifest.sourceAudioPath);
const { error: sourceUploadError } = await supabase.storage
	.from('shadowing-audio')
	.upload(sourceStoragePath, sourceBytes, { contentType: sourceContentType, upsert: true });
if (sourceUploadError) {
	console.error('Failed to upload source audio:', sourceUploadError.message);
	process.exit(1);
}

console.log('Transcoding to a browser-compatible AAC/m4a playback copy...');
transcodeForPlayback(manifest.sourceAudioPath, playbackPath);
console.log(`Uploading playback copy to ${playbackStoragePath}...`);
const playbackBytes = readFileSync(playbackPath);
const { error: playbackUploadError } = await supabase.storage
	.from('shadowing-audio')
	.upload(playbackStoragePath, playbackBytes, { contentType: 'audio/mp4', upsert: true });
if (playbackUploadError) {
	console.error('Failed to upload playback copy:', playbackUploadError.message);
	process.exit(1);
}

const chunkId = `${slug}:${chunkingVersion}:00`;
function buildChunkRow(recordingId: number) {
	return {
		recording_id: recordingId,
		user_id: userId,
		chunk_index: 0,
		chunk_id: chunkId,
		audio_path: playbackStoragePath,
		start_ms: 0,
		duration_ms: manifest.durationMs,
		transcript: manifest.transcript,
		kana: manifest.kana,
		translation: manifest.translation
	};
}

if (existingRecording) {
	// The recording update, old-chunk delete, and new-chunk insert all run
	// inside one DB transaction (publish_shadowing_recording, see the
	// matching migration) — a mid-swap failure rolls back completely rather
	// than leaving the recording with zero live chunks. The new-version
	// file is already uploaded above, so this is the only remaining step.
	const { error: rpcError } = await supabase.rpc('publish_shadowing_recording', {
		p_recording_id: existingRecording.id,
		p_source_audio_path: sourceStoragePath,
		p_duration_ms: manifest.durationMs,
		p_transcript: manifest.transcript,
		p_transcript_source: manifest.transcriptSource,
		p_chunking_version: chunkingVersion,
		p_chunk_rows: [buildChunkRow(existingRecording.id)]
	});
	if (rpcError) {
		console.error('Failed to swap in the new chunking_version:', rpcError.message);
		console.error(
			`The previous chunking_version's chunk is still fully intact (the swap is transactional) — the new-version audio is already uploaded, so re-running "npm run ingest:publish -- --slug ${slug} --user ${username}" retries safely.`
		);
		process.exit(1);
	}
	console.log(`\nPublished "${slug}" for ${username} at chunking_version ${chunkingVersion}.`);
	console.log(
		`The previous chunking_version's audio (v${existingRecording.chunking_version}) is now unreferenced but NOT deleted — a client that started a session before this re-publish may still hold a signed URL into it (valid up to 2h, see SIGNED_URL_TTL_SECONDS in shadowing-repository.ts). Once you're confident no such session is still active, run "npm run ingest:cleanup-old-versions -- --slug ${slug} --user ${username}" to remove it.`
	);
} else {
	// No prior version to protect — a plain insert-then-insert is enough.
	// If the chunk insert below fails, the orphaned empty recording row
	// self-heals on the next run: it becomes "existingRecording" above, and
	// that re-publish goes through the transactional swap path.
	const { data: inserted, error: insertError } = await supabase
		.from('shadowing_recordings')
		.insert({
			user_id: userId,
			slug,
			duration_ms: manifest.durationMs,
			source_audio_path: sourceStoragePath,
			transcript: manifest.transcript,
			transcript_source: manifest.transcriptSource,
			chunking_version: chunkingVersion
		})
		.select('id')
		.single();
	if (insertError || !inserted) {
		console.error('Failed to insert recording:', insertError?.message);
		process.exit(1);
	}
	const { error: chunkInsertError } = await supabase
		.from('shadowing_chunks')
		.insert({ ...buildChunkRow(inserted.id), verified_at: new Date().toISOString() });
	if (chunkInsertError) {
		console.error('Failed to insert chunk row:', chunkInsertError.message);
		process.exit(1);
	}
	console.log(`\nPublished "${slug}" for ${username} at chunking_version ${chunkingVersion}.`);
}
