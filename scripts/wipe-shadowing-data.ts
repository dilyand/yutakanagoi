import { createAdminClient } from './lib/supabase-admin.ts';

// One-time reset for the 3.1.0 no-chunking pivot (see CHANGELOG). Every
// existing shadowing recording/chunk was cut with the old chunk-boundary
// pipeline that's being removed entirely, and no shadowing progress was
// worth carrying through a pivot that also changes progress granularity
// from per-sentence to per-recording — so this wipes all shadowing data in
// the target project clean, ready for a fresh re-ingest with the new
// tool.
//
// Deletes, in FK-safe order: shadowing_session_attempts, then
// shadowing_sessions, then shadowing_state, then shadowing_chunks, then
// shadowing_recordings — then removes every object under the
// shadowing-audio Storage bucket. Every other table in this app is
// untouched.
//
// This targets whatever project SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
// (from --env-file) point at — run against local/staging first, then only
// against production after explicit confirmation. See "Production data
// changes" in the root CLAUDE.md.

const dryRun = process.argv.includes('--dry-run');

console.log(`Target: ${process.env.SUPABASE_URL} (dry-run: ${dryRun})`);

const supabase = createAdminClient();

const TABLES_IN_DELETE_ORDER = [
	'shadowing_session_attempts',
	'shadowing_sessions',
	'shadowing_state',
	'shadowing_chunks',
	'shadowing_recordings'
] as const;

for (const table of TABLES_IN_DELETE_ORDER) {
	const { count, error: countError } = await supabase
		.from(table)
		.select('id', { count: 'exact', head: true });
	if (countError) throw countError;

	if (dryRun) {
		console.log(`[dry-run] Would delete ${count ?? 0} row(s) from ${table}.`);
		continue;
	}
	// gt('id', 0) matches every row — every id column in this schema is a
	// `bigint generated always as identity`, always >= 1 — since
	// supabase-js's .delete() refuses to run with no filter at all.
	const { error: deleteError } = await supabase.from(table).delete().gt('id', 0);
	if (deleteError) throw deleteError;
	console.log(`Deleted ${count ?? 0} row(s) from ${table}.`);
}

// Storage objects live under users/<user_id>/<slug>/v<version>/... — walk
// the tree explicitly rather than assuming any fixed depth, since a
// listing call only ever returns one level.
const BUCKET = 'shadowing-audio';
const PAGE_SIZE = 100;

async function listAll(prefix: string): Promise<{ name: string; id: string | null }[]> {
	const all: { name: string; id: string | null }[] = [];
	let offset = 0;
	for (;;) {
		const { data, error } = await supabase.storage
			.from(BUCKET)
			.list(prefix, { limit: PAGE_SIZE, offset });
		if (error) throw error;
		if (!data || data.length === 0) break;
		all.push(...data);
		if (data.length < PAGE_SIZE) break;
		offset += PAGE_SIZE;
	}
	return all;
}

/** A Storage "folder" is really just an entry with no id — a real object always has one. */
async function collectFilePaths(prefix: string): Promise<string[]> {
	const entries = await listAll(prefix);
	const paths: string[] = [];
	for (const entry of entries) {
		const entryPath = prefix ? `${prefix}/${entry.name}` : entry.name;
		if (entry.id === null) {
			paths.push(...(await collectFilePaths(entryPath)));
		} else {
			paths.push(entryPath);
		}
	}
	return paths;
}

const allPaths = await collectFilePaths('users');
if (dryRun) {
	console.log(
		`[dry-run] Would remove ${allPaths.length} object(s) from Storage bucket "${BUCKET}".`
	);
	process.exit(0);
}

if (allPaths.length > 0) {
	// Storage's remove() has its own batch-size practicalities — chunk
	// defensively rather than assuming an unbounded single call is safe.
	const REMOVE_BATCH = 100;
	for (let i = 0; i < allPaths.length; i += REMOVE_BATCH) {
		const batch = allPaths.slice(i, i + REMOVE_BATCH);
		const { error: removeError } = await supabase.storage.from(BUCKET).remove(batch);
		if (removeError) throw removeError;
	}
	console.log(`Removed ${allPaths.length} object(s) from Storage bucket "${BUCKET}".`);
} else {
	console.log(`No objects to remove from Storage bucket "${BUCKET}".`);
}

console.log('\nDone — shadowing data fully wiped.');
