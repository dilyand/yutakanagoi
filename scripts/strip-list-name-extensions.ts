import { createAdminClient } from './lib/supabase-admin.ts';

// One-off backfill for the naming-convention change in the #28 update-list
// work: word_lists.name used to be the raw uploaded filename (e.g.
// "japanese-2000-most-frequent-words.md"), which is misleading now that the
// extension isn't otherwise meaningful (and would be more so once other file
// types are supported) — new uploads strip it client-side
// (ListSelector.svelte's stripExtension), but that doesn't retroactively
// rename already-created lists. This applies the same stripping to every
// existing word_lists row.
//
// Only touches word_lists.name — list_words/word_state/vocab_session_attempts
// key off list_id and word, never name, so there's no FK/cascade concern here
// (unlike scripts/scrub-master-list-cleanup.ts's word-level edits).
//
// word_lists has a unique (user_id, name) constraint: if a user somehow has
// both "list" and "list.txt", stripping the second would collide with the
// first. Guarded against below by skipping (not erroring) any row whose
// stripped name already exists for that user, so one bad row can't abort the
// whole run.
function stripExtension(filename: string): string {
	const dotIndex = filename.lastIndexOf('.');
	return dotIndex > 0 ? filename.slice(0, dotIndex) : filename;
}

const dryRun = process.argv.includes('--dry-run');

console.log(`Target: ${process.env.SUPABASE_URL} (dry-run: ${dryRun})`);

const supabase = createAdminClient();

const { data: lists, error: listsError } = await supabase
	.from('word_lists')
	.select('id, user_id, name');
if (listsError) throw listsError;

if (!lists || lists.length === 0) {
	console.log('No word_lists rows found — nothing to do.');
	process.exit(0);
}

const namesByUser = new Map<number, Set<string>>();
for (const list of lists) {
	if (!namesByUser.has(list.user_id)) namesByUser.set(list.user_id, new Set());
	namesByUser.get(list.user_id)!.add(list.name);
}

let renamed = 0;
let skippedNoExtension = 0;
let skippedCollision = 0;

for (const list of lists) {
	const stripped = stripExtension(list.name);
	if (stripped === list.name) {
		skippedNoExtension += 1;
		continue;
	}

	const existingNamesForUser = namesByUser.get(list.user_id)!;
	if (existingNamesForUser.has(stripped)) {
		console.log(
			`  SKIP (collision): list_id ${list.id} (user_id ${list.user_id}) "${list.name}" -> ` +
				`"${stripped}" already exists for this user`
		);
		skippedCollision += 1;
		continue;
	}

	console.log(
		`  RENAME: list_id ${list.id} (user_id ${list.user_id}) "${list.name}" -> "${stripped}"`
	);
	renamed += 1;

	if (!dryRun) {
		const { error: updateError } = await supabase
			.from('word_lists')
			.update({ name: stripped })
			.eq('id', list.id);
		if (updateError) throw updateError;
	}
}

console.log(
	`\n${dryRun ? 'Would rename' : 'Renamed'} ${renamed}, skipped ${skippedNoExtension} ` +
		`(no extension), skipped ${skippedCollision} (name collision).`
);
