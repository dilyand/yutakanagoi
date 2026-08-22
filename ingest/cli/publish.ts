import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, requireString } from '../args.ts';
import { createAdminClient } from '../../scripts/lib/supabase-admin.ts';

const USAGE = `Usage: npm run ingest:publish -- --slug <slug> --user <username> [--dry-run]

Reads ingest/work/<user>/<slug>/chunks.json, checks every chunk verified
clean during ingest:cut and has non-empty kana/translation, then uploads
audio to Supabase Storage and inserts/updates the DB rows. Re-publishing an
existing (user, slug) bumps chunking_version and replaces its chunks —
progress on the old version's chunks is orphaned, not migrated (see
supabase/README.md's "Shadowing tables" section for why).`;

const args = parseArgs(process.argv.slice(2));
const slug = requireString(args, 'slug', USAGE);
const username = requireString(args, 'user', USAGE);
const dryRun = args['dry-run'] === true;

const workDir = path.join(import.meta.dirname, '..', 'work', username, slug);
const chunksPath = path.join(workDir, 'chunks.json');
if (!existsSync(chunksPath)) {
	console.error(`No chunks.json at ${chunksPath} — run ingest:cut first.`);
	process.exit(1);
}

interface ChunkManifestEntry {
	index: number;
	audioFile: string;
	startMs: number;
	durationMs: number;
	transcript: string;
	kana: string;
	translation: string;
	verified: boolean;
	verifyFailures: string[];
}

interface ChunkManifest {
	slug: string;
	user: string;
	sourceAudioPath: string;
	durationMs: number;
	transcript: string;
	transcriptSource: 'supplied' | 'asr';
	recordedOn: string | null;
	chunks: ChunkManifestEntry[];
}

const manifest: ChunkManifest = JSON.parse(readFileSync(chunksPath, 'utf8'));

const unverified = manifest.chunks.filter((c) => !c.verified);
if (unverified.length > 0) {
	console.error(
		`${unverified.length} chunk(s) never verified clean during ingest:cut — re-run ingest:cut, don't edit chunks.json's "verified" field by hand. Affected: ${unverified.map((c) => c.audioFile).join(', ')}`
	);
	process.exit(1);
}
const unenriched = manifest.chunks.filter(
	(c) => c.kana.trim() === '' || c.translation.trim() === ''
);
if (unenriched.length > 0) {
	console.error(
		`${unenriched.length} chunk(s) still have an empty "kana" or "translation" field — fill those in chunks.json first. Affected: ${unenriched.map((c) => c.audioFile).join(', ')}`
	);
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
const chunkingVersion = existingRecording ? existingRecording.chunking_version + 1 : 1;

const sourceExt = path.extname(manifest.sourceAudioPath) || '.m4a';
const sourceStoragePath = `users/${userId}/${slug}/source${sourceExt}`;
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
	'.m4a': 'audio/mp4',
	'.mp3': 'audio/mpeg',
	'.wav': 'audio/wav',
	'.ogg': 'audio/ogg'
};
const sourceContentType = CONTENT_TYPE_BY_EXT[sourceExt] ?? 'application/octet-stream';

console.log(
	`${existingRecording ? `Re-publishing "${slug}" for ${username} — bumping to chunking_version ${chunkingVersion}, replacing its ${manifest.chunks.length} chunk(s).` : `Publishing "${slug}" for ${username} — chunking_version ${chunkingVersion}, ${manifest.chunks.length} chunk(s).`}`
);

if (dryRun) {
	console.log(`[dry-run] Would upload source to ${sourceStoragePath}`);
	for (const chunk of manifest.chunks) {
		console.log(
			`[dry-run] Would upload chunk ${chunk.index} to users/${userId}/${slug}/v${chunkingVersion}/${chunk.audioFile}`
		);
	}
	console.log(
		'[dry-run] Would insert/update shadowing_recordings and insert shadowing_chunks. No changes made.'
	);
	process.exit(0);
}

// Upload every new-version file BEFORE touching any DB row. On a
// re-publish this matters: the new chunking_version's storage paths never
// collide with the currently-live version's (the version number is in the
// path), so nothing here can clobber what's currently served. Staging the
// files first means a Storage failure (network, a bad file) leaves the
// previous version's recording and chunk rows completely untouched — the
// DB swap below only runs once every new file is safely uploaded.
console.log(`Uploading source audio to ${sourceStoragePath}...`);
const sourceBytes = readFileSync(manifest.sourceAudioPath);
const { error: sourceUploadError } = await supabase.storage
	.from('shadowing-audio')
	.upload(sourceStoragePath, sourceBytes, { contentType: sourceContentType, upsert: true });
if (sourceUploadError) {
	console.error('Failed to upload source audio:', sourceUploadError.message);
	process.exit(1);
}

const chunkUploads: { chunk: ChunkManifestEntry; storagePath: string }[] = [];
for (const chunk of manifest.chunks) {
	const n = String(chunk.index).padStart(2, '0');
	const storagePath = `users/${userId}/${slug}/v${chunkingVersion}/${chunk.audioFile}`;
	console.log(`Uploading chunk ${n} to ${storagePath}...`);
	const bytes = readFileSync(path.join(workDir, chunk.audioFile));
	const { error: uploadError } = await supabase.storage
		.from('shadowing-audio')
		.upload(storagePath, bytes, { contentType: 'audio/mp4', upsert: true });
	if (uploadError) {
		console.error(`Failed to upload ${chunk.audioFile}:`, uploadError.message);
		process.exit(1);
	}
	chunkUploads.push({ chunk, storagePath });
}

function buildChunkRow(recordingId: number, chunk: ChunkManifestEntry, storagePath: string) {
	return {
		recording_id: recordingId,
		user_id: userId,
		chunk_index: chunk.index,
		chunk_id: `${slug}:${chunkingVersion}:${String(chunk.index).padStart(2, '0')}`,
		audio_path: storagePath,
		// start_ms/duration_ms are integer columns; chunk-planner's output
		// carries fractional ms (ffmpeg's silencedetect reports fractional
		// seconds) — round at this DB boundary rather than earlier, since
		// fractional ms don't hurt any of the intermediate ffmpeg calls.
		start_ms: Math.round(chunk.startMs),
		duration_ms: Math.round(chunk.durationMs),
		transcript: chunk.transcript,
		kana: chunk.kana,
		translation: chunk.translation
	};
}

if (existingRecording) {
	// The recording update, old-chunk delete, and new-chunk insert all run
	// inside one DB transaction (publish_shadowing_recording, see the
	// matching migration) — a mid-swap failure rolls back completely rather
	// than leaving the recording with zero live chunks. Every new-version
	// file is already uploaded above, so this is the only remaining step.
	const chunkRows = chunkUploads.map(({ chunk, storagePath }) =>
		buildChunkRow(existingRecording.id, chunk, storagePath)
	);
	const { error: rpcError } = await supabase.rpc('publish_shadowing_recording', {
		p_recording_id: existingRecording.id,
		p_source_audio_path: sourceStoragePath,
		p_duration_ms: manifest.durationMs,
		p_transcript: manifest.transcript,
		p_transcript_source: manifest.transcriptSource,
		p_chunking_version: chunkingVersion,
		p_chunk_rows: chunkRows
	});
	if (rpcError) {
		console.error('Failed to swap in the new chunking_version:', rpcError.message);
		console.error(
			`The previous chunking_version's chunks are still fully intact (the swap is transactional) — all new-version audio is already uploaded, so re-running "npm run ingest:publish -- --slug ${slug} --user ${username}" retries safely.`
		);
		process.exit(1);
	}
	console.log(
		`\nPublished "${slug}" for ${username}: ${chunkRows.length} chunk(s) at chunking_version ${chunkingVersion}.`
	);

	// The old chunking_version's DB rows are already gone (the RPC deleted
	// them), so nothing points at its Storage objects any more — safe to
	// remove them now rather than letting every re-publish accumulate
	// another orphaned version's worth of audio indefinitely. Best-effort:
	// the DB swap already succeeded, so a cleanup failure here shouldn't
	// fail the whole publish, just leave those objects for a later pass.
	const oldVersionPrefix = `users/${userId}/${slug}/v${existingRecording.chunking_version}`;
	const { data: oldObjects, error: listError } = await supabase.storage
		.from('shadowing-audio')
		.list(oldVersionPrefix);
	if (listError) {
		console.error(
			`Could not list the previous chunking_version's storage objects to clean up: ${listError.message}`
		);
	} else if (oldObjects.length > 0) {
		const oldPaths = oldObjects.map((o) => `${oldVersionPrefix}/${o.name}`);
		const { error: removeError } = await supabase.storage.from('shadowing-audio').remove(oldPaths);
		if (removeError) {
			console.error(
				`Could not remove the previous chunking_version's storage objects: ${removeError.message}`
			);
		} else {
			console.log(
				`Removed ${oldPaths.length} file(s) from the previous chunking_version (v${existingRecording.chunking_version}).`
			);
		}
	}
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
	const chunkRows = chunkUploads.map(({ chunk, storagePath }) => ({
		...buildChunkRow(inserted.id, chunk, storagePath),
		verified_at: new Date().toISOString()
	}));
	const { error: chunksInsertError } = await supabase.from('shadowing_chunks').insert(chunkRows);
	if (chunksInsertError) {
		console.error('Failed to insert chunk rows:', chunksInsertError.message);
		process.exit(1);
	}
	console.log(
		`\nPublished "${slug}" for ${username}: ${chunkRows.length} chunk(s) at chunking_version ${chunkingVersion}.`
	);
}
