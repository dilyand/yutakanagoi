import { createAdminClient } from './lib/supabase-admin.ts';
import { fetchAllRows } from '../src/lib/supabase-pagination.ts';

// Usernames are never hardcoded here or written to any committed file — only
// ever passed at the shell and stored in the `users` table.
//
// Run this AFTER applying supabase/migrations/20260704000001_users_lists_additive.sql
// and BEFORE applying 20260704000002_finalize_list_scoping.sql (see that
// migration's header comment and supabase/README.md) — it depends on
// word_state/sessions/session_attempts still having their 0.1.0 columns
// (in particular session_attempts.session_index, which part 2 drops) plus
// the new nullable list_id columns from part 1.
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const [primaryUsername, secondUsername] = args.filter((a) => !a.startsWith('--'));

if (!primaryUsername || !secondUsername) {
	console.error(
		'Usage: npm run migrate:legacy-user-list -- <primary-username> <second-username> [--dry-run]'
	);
	console.error(
		'  primary-username: owns the existing word_state/sessions/session_attempts progress'
	);
	console.error('  second-username:  gets a fresh copy of the same list with no progress');
	process.exit(1);
}

// list name = the renamed vocab-master.md filename, per the "list name = filename" convention.
const LIST_NAME = 'japanese-2000-most-frequent-words.md';

const supabase = createAdminClient();

async function ensureUser(username: string): Promise<number> {
	const { data: existing, error: selectError } = await supabase
		.from('users')
		.select('id')
		.eq('username', username)
		.maybeSingle();
	if (selectError) throw selectError;
	if (existing) return existing.id;

	const { data: inserted, error: insertError } = await supabase
		.from('users')
		.insert({ username })
		.select('id')
		.single();
	if (insertError) throw insertError;
	return inserted.id;
}

async function ensureWordList(userId: number, name: string): Promise<number> {
	const { data: existing, error: selectError } = await supabase
		.from('word_lists')
		.select('id')
		.eq('user_id', userId)
		.eq('name', name)
		.maybeSingle();
	if (selectError) throw selectError;
	if (existing) return existing.id;

	const { data: inserted, error: insertError } = await supabase
		.from('word_lists')
		.insert({ user_id: userId, name })
		.select('id')
		.single();
	if (insertError) throw insertError;
	return inserted.id;
}

interface VocabMasterRow {
	word: string;
	frequency_rank: number;
}

const vocabRows = await fetchAllRows<VocabMasterRow>(
	supabase,
	'vocab_master',
	'word, frequency_rank'
);
console.log(`Read ${vocabRows.length} words from vocab_master.`);

if (dryRun) {
	console.log(
		`--dry-run: would create users "${primaryUsername}"/"${secondUsername}" (if missing), ` +
			`two "${LIST_NAME}" lists (${vocabRows.length} list_words rows each), and backfill ` +
			`list_id on existing word_state/sessions/session_attempts rows for "${primaryUsername}".`
	);
	process.exit(0);
}

const primaryUserId = await ensureUser(primaryUsername);
const secondUserId = await ensureUser(secondUsername);
console.log(`Users ready: ${primaryUsername}=${primaryUserId}, ${secondUsername}=${secondUserId}`);

const primaryListId = await ensureWordList(primaryUserId, LIST_NAME);
const secondListId = await ensureWordList(secondUserId, LIST_NAME);
console.log(
	`Lists ready: ${primaryUsername}'s list=${primaryListId}, ${secondUsername}'s list=${secondListId}`
);

for (const [label, listId] of [
	[primaryUsername, primaryListId],
	[secondUsername, secondListId]
] as const) {
	const { error, count } = await supabase.from('list_words').upsert(
		vocabRows.map((row) => ({
			list_id: listId,
			word: row.word,
			frequency_rank: row.frequency_rank
		})),
		{ onConflict: 'list_id,word', count: 'exact' }
	);
	if (error) throw error;
	console.log(`Upserted ${count ?? vocabRows.length} list_words rows for ${label}'s list.`);
}

// Backfill list_id on the 0.1.0 progress tables — scoped to primaryUserId's list only,
// since secondUsername starts with zero drilled words.
const { error: wordStateError, count: wordStateCount } = await supabase
	.from('word_state')
	.update({ list_id: primaryListId }, { count: 'exact' })
	.is('list_id', null);
if (wordStateError) throw wordStateError;
console.log(`Backfilled list_id on ${wordStateCount ?? 0} word_state rows.`);

const { error: sessionsError, count: sessionsCount } = await supabase
	.from('sessions')
	.update({ list_id: primaryListId }, { count: 'exact' })
	.is('list_id', null);
if (sessionsError) throw sessionsError;
console.log(`Backfilled list_id on ${sessionsCount ?? 0} sessions rows.`);

const { data: sessionRows, error: sessionRowsError } = await supabase
	.from('sessions')
	.select('id, session_index')
	.eq('list_id', primaryListId);
if (sessionRowsError) throw sessionRowsError;
const sessionIndexToId = new Map(sessionRows.map((row) => [row.session_index, row.id]));

const { data: attemptsToBackfill, error: attemptsSelectError } = await supabase
	.from('session_attempts')
	.select('id, session_index')
	.is('list_id', null);
if (attemptsSelectError) throw attemptsSelectError;

let backfilledAttempts = 0;
for (const attempt of attemptsToBackfill ?? []) {
	const sessionId = sessionIndexToId.get(attempt.session_index);
	if (sessionId === undefined) {
		throw new Error(
			`No sessions row with session_index=${attempt.session_index} for session_attempts.id=${attempt.id}`
		);
	}
	const { error } = await supabase
		.from('session_attempts')
		.update({ list_id: primaryListId, session_id: sessionId })
		.eq('id', attempt.id);
	if (error) throw error;
	backfilledAttempts += 1;
}
console.log(`Backfilled list_id + session_id on ${backfilledAttempts} session_attempts rows.`);

console.log(
	'Done. Next: apply supabase/migrations/20260704000002_finalize_list_scoping.sql to ' +
		'enforce the final constraints and drop vocab_master.'
);
