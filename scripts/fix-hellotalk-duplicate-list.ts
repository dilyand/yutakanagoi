import { createAdminClient } from './lib/supabase-admin.ts';

// One-time cleanup for the hello-talk / hellotalk-words duplicate list
// incident (2026-08-23). Root cause: hellotalk-words was hand-typed before
// list-naming.ts's deriveListName existed (2.1.0), so it doesn't match what
// deriveListName("HelloTalk.xml") produces ("hello-talk") — every re-upload
// of this file was doomed to create a new list rather than update the real
// one. That mismatch combined with createWordList's non-atomic two-step
// insert (see supabase/migrations/20260823000001_*.sql) to leave an
// orphaned, never-drilled "hello-talk" list behind on a failed/retried
// upload, while the real "hellotalk-words" list (drill history intact) was
// never touched.
//
// This script: finds both lists by name for the given username, verifies
// the "hello-talk" one really has zero drill history (refuses to touch
// anything if not — that would mean this environment's history doesn't
// match the incident this script was written for), deletes it, then renames
// "hellotalk-words" to "hello-talk" so it matches what deriveListName will
// always produce for this filename going forward. After this runs,
// re-uploading HelloTalk.xml correctly matches and offers to update the
// real list.
const USERNAME = process.argv[2];
const ORPHAN_NAME = 'hello-talk';
const REAL_NAME = 'hellotalk-words';

const dryRun = process.argv.includes('--dry-run');

if (!USERNAME) {
	console.error('Usage: tsx scripts/fix-hellotalk-duplicate-list.ts <username> [--dry-run]');
	process.exit(1);
}

console.log(`Target: ${process.env.SUPABASE_URL} (dry-run: ${dryRun})`);

const supabase = createAdminClient();

const { data: user, error: userError } = await supabase
	.from('users')
	.select('id, username')
	.eq('username', USERNAME)
	.single();
if (userError) throw userError;

const { data: lists, error: listsError } = await supabase
	.from('word_lists')
	.select('id, name')
	.eq('user_id', user.id)
	.in('name', [ORPHAN_NAME, REAL_NAME]);
if (listsError) throw listsError;

const orphanList = lists?.find((l) => l.name === ORPHAN_NAME);
const realList = lists?.find((l) => l.name === REAL_NAME);

if (!orphanList || !realList) {
	throw new Error(
		`Expected both "${ORPHAN_NAME}" and "${REAL_NAME}" lists for user "${USERNAME}". ` +
			`Found: ${lists?.map((l) => l.name).join(', ') || '(none)'}. Nothing to do.`
	);
}

const { count: orphanStateCount, error: orphanStateError } = await supabase
	.from('word_state')
	.select('*', { count: 'exact', head: true })
	.eq('list_id', orphanList.id);
if (orphanStateError) throw orphanStateError;

const { count: orphanSessionCount, error: orphanSessionError } = await supabase
	.from('vocab_sessions')
	.select('*', { count: 'exact', head: true })
	.eq('list_id', orphanList.id);
if (orphanSessionError) throw orphanSessionError;

if ((orphanStateCount ?? 0) > 0 || (orphanSessionCount ?? 0) > 0) {
	throw new Error(
		`Refusing to delete list ${orphanList.id} ("${orphanList.name}"): it has ` +
			`${orphanStateCount} word_state row(s) and ${orphanSessionCount} session(s). ` +
			`This script is only safe for a list with zero drill history.`
	);
}

const { count: orphanWordCount, error: orphanWordCountError } = await supabase
	.from('list_words')
	.select('*', { count: 'exact', head: true })
	.eq('list_id', orphanList.id);
if (orphanWordCountError) throw orphanWordCountError;

console.log(
	`Orphan list ${orphanList.id} ("${orphanList.name}"): ${orphanWordCount} words, ` +
		`0 word_state, 0 sessions — safe to delete.`
);
console.log(`Real list ${realList.id} ("${realList.name}") will be renamed to "${ORPHAN_NAME}".`);

if (!dryRun) {
	const { error: deleteWordsError } = await supabase
		.from('list_words')
		.delete()
		.eq('list_id', orphanList.id);
	if (deleteWordsError) throw deleteWordsError;

	const { error: deleteListError } = await supabase
		.from('word_lists')
		.delete()
		.eq('id', orphanList.id);
	if (deleteListError) throw deleteListError;

	// Deleting the orphan first frees up the (user_id, name) unique
	// constraint that this rename would otherwise collide with.
	const { error: renameError } = await supabase
		.from('word_lists')
		.update({ name: ORPHAN_NAME })
		.eq('id', realList.id);
	if (renameError) throw renameError;

	console.log(`Deleted list ${orphanList.id} and renamed list ${realList.id} to "${ORPHAN_NAME}".`);
} else {
	console.log('\n--dry-run: no changes written.');
}
