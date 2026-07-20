import { createAdminClient } from './lib/supabase-admin.ts';

// One-time cleanup for the hellotalk-words list (2.2.2): two bugs found
// against the original HellotalkWords.xml export.
//
// 1. AnkiApp lets a card's Japanese field carry a furigana reading override
//    using doubled corner brackets appended to the word (e.g.
//    過ぎる「「すぎる」」) — parseAnkiAppDeck took the field verbatim, so the
//    override was absorbed into the word itself instead of being stripped
//    (fixed going forward in src/lib/ankiapp-deck-parser.ts; this script
//    corrects the 3 rows already corrupted this way).
// 2. 連れて is a genuine mis-entry in the source deck — should be につれて
//    (confirmed against the card's own Meaning field, "as", which matches
//    につれて not 連れて).
//
// Same REPLACE dance as scrub-master-list-cleanup.ts: word_state and
// vocab_session_attempts both have a real FK to list_words(list_id, word),
// so a rename must insert the new spelling first (at a negative placeholder
// frequency_rank, since (list_id, frequency_rank) is also unique), repoint
// history to it, delete the old spelling, then restore the real rank.
const LIST_NAME = 'hellotalk-words';

const dryRun = process.argv.includes('--dry-run');

const REPLACE_PAIRS = [
	{ from: '宝物「「たからもの」」', to: '宝物' },
	{ from: '内出血「「ないしゅっけつ」」', to: '内出血' },
	{ from: '過ぎる「「すぎる」」', to: '過ぎる' },
	{ from: '連れて', to: 'につれて' }
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

	for (const { from, to } of REPLACE_PAIRS) {
		const { data: oldRow } = await supabase
			.from('list_words')
			.select('frequency_rank')
			.eq('list_id', list.id)
			.eq('word', from)
			.maybeSingle();
		if (!oldRow) {
			console.log(`  REPLACE ${from} -> ${to}: no matching list_words row, skipping`);
			continue;
		}

		console.log(
			`  REPLACE ${from} -> ${to}: 1 list_words row matched (frequency_rank ${oldRow.frequency_rank})`
		);

		if (!dryRun) {
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
