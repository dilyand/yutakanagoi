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
const { data: entries, error: listError } = await supabase.storage
	.from('shadowing-audio')
	.list(basePrefix);
if (listError) {
	console.error('Failed to list Storage entries:', listError.message);
	process.exit(1);
}

const oldVersions = (entries ?? [])
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

let totalRemoved = 0;
for (const version of oldVersions) {
	const versionPrefix = `${basePrefix}/v${version}`;
	const { data: versionFiles, error: versionListError } = await supabase.storage
		.from('shadowing-audio')
		.list(versionPrefix);
	if (versionListError) {
		console.error(`Failed to list v${version}:`, versionListError.message);
		continue;
	}
	if (!versionFiles || versionFiles.length === 0) continue;

	const paths = versionFiles.map((f) => `${versionPrefix}/${f.name}`);
	if (dryRun) {
		for (const p of paths) console.log(`[dry-run] Would remove ${p}`);
		continue;
	}
	const { error: removeError } = await supabase.storage.from('shadowing-audio').remove(paths);
	if (removeError) {
		console.error(`Failed to remove v${version}'s files:`, removeError.message);
		continue;
	}
	console.log(`Removed ${paths.length} file(s) from v${version}.`);
	totalRemoved += paths.length;
}

if (!dryRun) {
	console.log(`\nDone — removed ${totalRemoved} file(s) total.`);
}
