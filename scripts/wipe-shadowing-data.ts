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
// The five deletes run inside wipe_shadowing_data() (see the matching
// migration), a single Postgres transaction, not five separate requests —
// a session created or completed by the live app between two of those
// requests could otherwise survive in whichever table was deleted first,
// even though the run as a whole reported success.
//
// That transaction does NOT serialize this reset against the live app,
// though — a plain DELETE doesn't block a concurrent INSERT, so a
// session/start or session/complete request already in flight when this
// runs can still commit its own write during or after the wipe, surviving
// it even though every table really was empty at the instant the deletes
// ran. Closing that fully would mean a maintenance-mode write-lock shared
// with every shadowing-table mutation path in the app (session/start,
// session/complete, the flag endpoint) — a meaningfully bigger change
// than a one-time reset script warrants, and not a pattern this codebase
// uses for any of its other one-off migration scripts either. The
// practical mitigation is operational, not technical: **make sure no
// device has the shadowing drill open (no in-flight session) before
// running this for real** — the two-pass verification below only catches
// a write that was already in flight, not one that starts later.
//
// This targets whatever project SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
// (from --env-file) point at — run against local/staging first, then only
// against production after explicit confirmation. See "Production data
// changes" in the root CLAUDE.md.

const dryRun = process.argv.includes('--dry-run');

console.log(`Target: ${process.env.SUPABASE_URL} (dry-run: ${dryRun})`);
if (!dryRun) {
	console.log(
		"This does not lock out the live app — confirm no device has the shadowing drill open (no in-flight session) before continuing. See this file's header comment for why."
	);
}

const supabase = createAdminClient();

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

const TABLES_IN_DELETE_ORDER = [
	'shadowing_session_attempts',
	'shadowing_sessions',
	'shadowing_state',
	'shadowing_chunks',
	'shadowing_recordings'
] as const;

if (dryRun) {
	for (const table of TABLES_IN_DELETE_ORDER) {
		const { count, error: countError } = await supabase
			.from(table)
			.select('id', { count: 'exact', head: true });
		if (countError) throw countError;
		console.log(`[dry-run] Would delete ${count ?? 0} row(s) from ${table}.`);
	}
} else {
	const { data: deletedCounts, error: wipeError } = await supabase.rpc('wipe_shadowing_data');
	if (wipeError) throw wipeError;
	for (const table of TABLES_IN_DELETE_ORDER) {
		console.log(`Deleted ${deletedCounts?.[table] ?? 0} row(s) from ${table}.`);
	}

	async function verifyAllEmpty(label: string): Promise<void> {
		for (const table of TABLES_IN_DELETE_ORDER) {
			const { count, error: verifyError } = await supabase
				.from(table)
				.select('id', { count: 'exact', head: true });
			if (verifyError) throw verifyError;
			if (count && count > 0) {
				throw new Error(
					`${table} has ${count} row(s) left after wipe_shadowing_data() reported success (${label} check) — either a live request wrote to it during/after the wipe (see this file's header comment on why the transaction alone can't prevent that), or something else is wrong. Investigate before re-ingesting.`
				);
			}
		}
		console.log(`Verified all five tables are empty (${label} check).`);
	}

	// Two passes, not one: the RPC's transaction guarantees the five
	// tables were genuinely empty at the instant its own DELETEs ran, but
	// can't see a session/start or session/complete request that was
	// already in flight and commits its own write moments later. A short
	// settle wait plus a second check catches that case — an already-in-
	// flight request, not one that starts fresh after this script exits,
	// which no finite wait can guarantee against (see header comment).
	await verifyAllEmpty('immediate');
	await sleep(3000);
	await verifyAllEmpty('settled');
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
