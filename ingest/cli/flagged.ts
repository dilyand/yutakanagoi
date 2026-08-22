import { parseArgs, requireString } from '../args.ts';
import { createAdminClient } from '../../scripts/lib/supabase-admin.ts';

const USAGE = `Usage: npm run ingest:flagged -- --user <username>

Lists this user's flagged shadowing chunks (via the app's Flag button) so a
debugging session can start with "let's debug flagged items" — prints each
chunk's recording, storage path, transcript, offsets, and flag note.`;

const args = parseArgs(process.argv.slice(2));
const username = requireString(args, 'user', USAGE);

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

// The relationship hint (!shadowing_chunks_recording_id_fkey) is required,
// not cosmetic — see the identical comment on fetchChunkLibrary in
// src/lib/server/shadowing-repository.ts for why an unhinted embed here
// fails outright once shadowing_chunks_recording_owner_fkey exists
// alongside the plain recording_id FK.
const { data: rows, error: rowsError } = await supabase
	.from('shadowing_chunks')
	.select(
		'chunk_id, audio_path, start_ms, duration_ms, transcript, flagged_at, flag_note, shadowing_recordings!shadowing_chunks_recording_id_fkey(slug)'
	)
	.eq('user_id', user.id)
	.not('flagged_at', 'is', null)
	.order('flagged_at', { ascending: false });
if (rowsError) {
	console.error('Failed to fetch flagged chunks:', rowsError.message);
	process.exit(1);
}

if (!rows || rows.length === 0) {
	console.log(`No flagged chunks for "${username}".`);
	process.exit(0);
}

console.log(`${rows.length} flagged chunk(s) for "${username}":\n`);
for (const row of rows) {
	const recording = Array.isArray(row.shadowing_recordings)
		? row.shadowing_recordings[0]
		: row.shadowing_recordings;
	console.log(`chunk_id:    ${row.chunk_id}`);
	console.log(`recording:   ${recording?.slug ?? '(unknown)'}`);
	console.log(`audio_path:  ${row.audio_path}`);
	console.log(`offsets:     ${row.start_ms}ms +${row.duration_ms}ms`);
	console.log(`transcript:  ${row.transcript}`);
	console.log(`flagged_at:  ${row.flagged_at}`);
	console.log(`note:        ${row.flag_note ?? '(none)'}`);
	console.log('');
}
