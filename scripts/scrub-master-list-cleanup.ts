import { createAdminClient } from './lib/supabase-admin.ts';

// One-time cleanup for issue #25: japanese-2000-most-frequent-words.md had 130
// corrupt/duplicate/archaic entries removed and 2 replaced with their standard
// spelling (see CLAUDE.md's cleanup-release notes for the full rationale per
// category). The file itself isn't read by the running app, but its content
// was copied verbatim into list_words for every user whose list is named
// after it (currently the two accounts created by the since-deleted
// scripts/migrate-legacy-user-list.ts — see supabase/README.md) — this
// script applies the same word-level diff to those DB rows so live user
// data matches the corrected source file.
//
// word_state AND vocab_session_attempts both have a real FK to
// list_words(list_id, word) (see 20260704000002_finalize_list_scoping.sql) —
// discovered by actually running this against the local stack, not assumed
// from the README's prose description. That means a REMOVE word's history
// can't be left dangling: removing it from list_words requires also removing
// its vocab_session_attempts rows, since a record of "drilling" a word later
// determined to be corrupt/duplicate/archaic isn't worth preserving. For
// REPLACE pairs, history is migrated to the new spelling instead of deleted:
// insert the new list_words row first (same frequency_rank, so ordering is
// preserved), repoint word_state/vocab_session_attempts to it, then delete
// the old list_words row — inserting before repointing avoids a transient FK
// violation (a child row briefly referencing a word no list_words row has
// yet).
const LIST_NAME = 'japanese-2000-most-frequent-words.md';

const dryRun = process.argv.includes('--dry-run');

const REMOVE_WORDS = [
	'うい',
	'かる',
	'さい',
	'つた',
	'たく',
	'けい',
	'あがる',
	'もどる',
	'しん',
	'下げ',
	'じゅう',
	'あう',
	'げん',
	'ちょう',
	'げき',
	'みせる',
	'泰',
	'しょ',
	'魅',
	'たん',
	'せん',
	'向う',
	'いえる',
	'がん',
	'之',
	'判る',
	'いち',
	'しゅん',
	'ぜん',
	'しゅう',
	'まわす',
	'ゆき',
	'おん',
	'まわる',
	'圭一',
	'きれる',
	'こく',
	'ぎょ',
	'っぽい',
	'おう',
	'やく',
	'きゅう',
	'こん',
	'りゅう',
	'ちがい',
	'とぶ',
	'伊',
	'其の',
	'ひざ',
	'斎',
	'われる',
	'ほお',
	'まわり',
	'坐る',
	'貴方',
	'まえる',
	'変る',
	'現われる',
	'有る',
	'だま',
	'われ',
	'のむ',
	'ほほ',
	'ごとし',
	'何処',
	'うえ',
	'ばる',
	'くつ',
	'気持',
	'とら',
	'うける',
	'聞える',
	'だいじょうぶ',
	'となり',
	'うわさ',
	'終る',
	'遣る',
	'隠る',
	'恐る',
	'行なう',
	'みちる',
	'もしか',
	'あご',
	'ふつう',
	'なん',
	'だす',
	'分る',
	'まつ',
	'たてる',
	'あく',
	'へん',
	'たた',
	'がた',
	'はん',
	'ひく',
	'はな',
	'じん',
	'てい',
	'れい',
	'ませる',
	'りょう',
	'てん',
	'来',
	'きん',
	'しょう',
	'らん',
	'ぞう',
	'離',
	'しよう',
	'めい',
	'斗',
	'重',
	'薄',
	'相',
	'みょう',
	'にゃ',
	'なぐ',
	'さわ',
	'まいる',
	'あたる',
	'のる',
	'仰る',
	'みえる',
	'言',
	'静',
	'令',
	'ぶり',
	'秘',
	'ぽい',
	'どおり'
];

const REPLACE_PAIRS = [
	{ from: 'やみ', to: '闇' },
	{ from: 'ほる', to: '掘る' }
];

console.log(`Target: ${process.env.SUPABASE_URL} (dry-run: ${dryRun})`);

const supabase = createAdminClient();

const { data: lists, error: listsError } = await supabase
	.from('word_lists')
	.select('id, user_id')
	.eq('name', LIST_NAME);
if (listsError) throw listsError;

if (!lists || lists.length === 0) {
	console.log(`No word_lists rows named "${LIST_NAME}" found — nothing to do.`);
	process.exit(0);
}

console.log(
	`Found ${lists.length} list(s) named "${LIST_NAME}": ${lists.map((l) => l.id).join(', ')}`
);

for (const list of lists) {
	console.log(`\n--- list_id ${list.id} (user_id ${list.user_id}) ---`);

	const { count: matchedListWords } = await supabase
		.from('list_words')
		.select('word', { count: 'exact', head: true })
		.eq('list_id', list.id)
		.in('word', REMOVE_WORDS);
	const { count: matchedWordState } = await supabase
		.from('word_state')
		.select('word', { count: 'exact', head: true })
		.eq('list_id', list.id)
		.in('word', REMOVE_WORDS);
	const { count: matchedAttempts } = await supabase
		.from('vocab_session_attempts')
		.select('word', { count: 'exact', head: true })
		.eq('list_id', list.id)
		.in('word', REMOVE_WORDS);

	console.log(
		`  REMOVE: ${matchedListWords ?? 0} list_words, ${matchedWordState ?? 0} word_state, ` +
			`${matchedAttempts ?? 0} vocab_session_attempts row(s) matched`
	);

	if (!dryRun) {
		// Children before parent: word_state and vocab_session_attempts both
		// have an FK to list_words(list_id, word).
		const { error: deleteAttemptsError, count: deletedAttempts } = await supabase
			.from('vocab_session_attempts')
			.delete({ count: 'exact' })
			.eq('list_id', list.id)
			.in('word', REMOVE_WORDS);
		if (deleteAttemptsError) throw deleteAttemptsError;

		const { error: deleteWordStateError, count: deletedWordState } = await supabase
			.from('word_state')
			.delete({ count: 'exact' })
			.eq('list_id', list.id)
			.in('word', REMOVE_WORDS);
		if (deleteWordStateError) throw deleteWordStateError;

		const { error: deleteListWordsError, count: deletedListWords } = await supabase
			.from('list_words')
			.delete({ count: 'exact' })
			.eq('list_id', list.id)
			.in('word', REMOVE_WORDS);
		if (deleteListWordsError) throw deleteListWordsError;

		console.log(
			`  Deleted ${deletedListWords ?? 0} list_words, ${deletedWordState ?? 0} word_state, ` +
				`${deletedAttempts ?? 0} vocab_session_attempts row(s)`
		);
	}

	for (const { from, to } of REPLACE_PAIRS) {
		const { data: oldRow } = await supabase
			.from('list_words')
			.select('frequency_rank')
			.eq('list_id', list.id)
			.eq('word', from)
			.maybeSingle();
		if (!oldRow) continue;

		console.log(
			`  REPLACE ${from} -> ${to}: 1 list_words row matched (frequency_rank ${oldRow.frequency_rank})`
		);

		if (!dryRun) {
			// list_words also has a unique (list_id, frequency_rank) constraint,
			// so the new row can't take the real rank until the old row is gone.
			// Sequence: insert the new spelling at a negative placeholder rank
			// (real ranks are always positive, so this can't collide) -> repoint
			// history to it -> delete the old spelling (now unreferenced) ->
			// restore the real rank on the new row (now free).
			const { error: insertError } = await supabase
				.from('list_words')
				.upsert(
					{ list_id: list.id, word: to, frequency_rank: -oldRow.frequency_rank },
					{ onConflict: 'list_id,word' }
				);
			if (insertError) throw insertError;

			const { error: replaceWordStateError, count: replacedWordState } = await supabase
				.from('word_state')
				.update({ word: to }, { count: 'exact' })
				.eq('list_id', list.id)
				.eq('word', from);
			if (replaceWordStateError) throw replaceWordStateError;

			const { error: replaceAttemptsError, count: replacedAttempts } = await supabase
				.from('vocab_session_attempts')
				.update({ word: to }, { count: 'exact' })
				.eq('list_id', list.id)
				.eq('word', from);
			if (replaceAttemptsError) throw replaceAttemptsError;

			const { error: deleteOldError } = await supabase
				.from('list_words')
				.delete()
				.eq('list_id', list.id)
				.eq('word', from);
			if (deleteOldError) throw deleteOldError;

			const { error: restoreRankError } = await supabase
				.from('list_words')
				.update({ frequency_rank: oldRow.frequency_rank })
				.eq('list_id', list.id)
				.eq('word', to);
			if (restoreRankError) throw restoreRankError;

			console.log(
				`  Replaced: 1 list_words row, ${replacedWordState ?? 0} word_state, ` +
					`${replacedAttempts ?? 0} vocab_session_attempts row(s)`
			);
		}
	}
}

if (dryRun) {
	console.log('\n--dry-run: no changes written.');
} else {
	console.log('\nDone.');
}
