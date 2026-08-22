import type { SupabaseClient } from '@supabase/supabase-js';
import { parseArgs, requireString } from '../args.ts';
import { createAdminClient } from '../../scripts/lib/supabase-admin.ts';

const USAGE = `Usage: npm run ingest:cleanup-old-versions -- --slug <slug> --user <username> [--dry-run]

Removes Storage objects (audio + source) for every chunking_version of this
recording OLDER than the currently live one. A deliberately separate,
manually-run step from ingest:publish — a re-publish's old-version audio is
unreferenced by the DB immediately after the swap, but a client that
started a session before the re-publish may still hold a signed URL into
it (valid up to 2h — see SIGNED_URL_TTL_SECONDS in
src/lib/server/shadowing-repository.ts). Run this once you're confident no
such session is still active, not automatically as part of publish.`;

// Storage .list() returns at most 100 entries per call by default —
// paginated explicitly here (via limit/offset) rather than trusting a
// single call, so a recording with more than 100 historical version
// folders, or a version with more than 100 files, doesn't silently drop
// entries beyond the first page.
const PAGE_SIZE = 100;

async function listAll(
	supabase: SupabaseClient,
	prefix: string
): Promise<{ name: string }[] | { error: string }> {
	const all: { name: string }[] = [];
	let offset = 0;
	for (;;) {
		const { data, error } = await supabase.storage
			.from('shadowing-audio')
			.list(prefix, { limit: PAGE_SIZE, offset });
		if (error) return { error: error.message };
		if (!data || data.length === 0) break;
		all.push(...data);
		if (data.length < PAGE_SIZE) break;
		offset += PAGE_SIZE;
	}
	return all;
}

const args = parseArgs(process.argv.slice(2));
const slug = requireString(args, 'slug', USAGE);
const username = requireString(args, 'user', USAGE);
const dryRun = args['dry-run'] === true;

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

const { data: recording, error: recordingError } = await supabase
	.from('shadowing_recordings')
	.select('chunking_version')
	.eq('user_id', userId)
	.eq('slug', slug)
	.maybeSingle();
if (recordingError) {
	console.error('Failed to look up recording:', recordingError.message);
	process.exit(1);
}
if (!recording) {
	console.error(`No recording named "${slug}" for "${username}".`);
	process.exit(1);
}
const currentVersion: number = recording.chunking_version;

const basePrefix = `users/${userId}/${slug}`;
const entries = await listAll(supabase, basePrefix);
if ('error' in entries) {
	console.error('Failed to list Storage entries:', entries.error);
	process.exit(1);
}

const oldVersions = entries
	.map((e) => e.name)
	.filter((name) => /^v\d+$/.test(name))
	.map((name) => Number(name.slice(1)))
	.filter((version) => version < currentVersion)
	.sort((a, b) => a - b);

if (oldVersions.length === 0) {
	console.log(`No old chunking_versions to clean up for "${slug}" (currently v${currentVersion}).`);
	process.exit(0);
}

console.log(
	`Found ${oldVersions.length} old chunking_version(s) for "${slug}" (currently v${currentVersion}): ${oldVersions.map((v) => `v${v}`).join(', ')}`
);

// Best-effort across versions (one bad version shouldn't block cleaning up
// the rest) — but track failures and exit nonzero if any occurred, rather
// than always printing "Done" regardless of whether every version was
// actually fully processed.
let totalRemoved = 0;
let anyFailed = false;
for (const version of oldVersions) {
	const versionPrefix = `${basePrefix}/v${version}`;
	const versionFiles = await listAll(supabase, versionPrefix);
	if ('error' in versionFiles) {
		console.error(`Failed to list v${version}:`, versionFiles.error);
		anyFailed = true;
		continue;
	}
	if (versionFiles.length === 0) continue;

	const paths = versionFiles.map((f) => `${versionPrefix}/${f.name}`);
	if (dryRun) {
		for (const p of paths) console.log(`[dry-run] Would remove ${p}`);
		continue;
	}
	const { error: removeError } = await supabase.storage.from('shadowing-audio').remove(paths);
	if (removeError) {
		console.error(`Failed to remove v${version}'s files:`, removeError.message);
		anyFailed = true;
		continue;
	}
	console.log(`Removed ${paths.length} file(s) from v${version}.`);
	totalRemoved += paths.length;
}

if (dryRun) {
	process.exit(anyFailed ? 1 : 0);
}
if (anyFailed) {
	console.error(
		`\nRemoved ${totalRemoved} file(s), but one or more versions failed to list or remove (see above) — re-run to retry those.`
	);
	process.exit(1);
}
console.log(`\nDone — removed ${totalRemoved} file(s) total.`);
