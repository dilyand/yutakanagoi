import { readFileSync } from 'node:fs';
import { parseVocabState } from './lib/parse-vocab-files.ts';
import { createAdminClient } from './lib/supabase-admin.ts';

const dryRun = process.argv.includes('--dry-run');

const markdown = readFileSync(new URL('../vocab-state.md', import.meta.url), 'utf-8');
const { sessionIndex, words } = parseVocabState(markdown);

console.log(
	`Parsed session_index=${sessionIndex} and ${words.length} tracked words from vocab-state.md`
);

const sessionRows = Array.from({ length: sessionIndex }, (_, i) => ({ session_index: i + 1 }));

if (dryRun) {
	console.log(
		`--dry-run: not writing to Supabase. Would upsert ${sessionRows.length} sessions rows.`
	);
	console.log('First 5 and last 5 word_state rows:');
	console.table([...words.slice(0, 5), ...words.slice(-5)]);
	process.exit(0);
}

const supabase = createAdminClient();

// vocab_master must already be seeded (run migrate-vocab-master.ts first) — word_state.word
// has a foreign key into it. Check up front for a clearer error than a bulk FK failure.
const { data: knownWords, error: vocabMasterError } = await supabase
	.from('vocab_master')
	.select('word');
if (vocabMasterError) {
	console.error('Failed to read vocab_master:', vocabMasterError.message);
	process.exit(1);
}
const knownWordSet = new Set((knownWords ?? []).map((row) => row.word));
const missing = words.filter((w) => !knownWordSet.has(w.word)).map((w) => w.word);
if (missing.length > 0) {
	console.error(
		`${missing.length} word(s) in vocab-state.md are not in vocab_master (run migrate-vocab-master.ts first): ${missing.join(', ')}`
	);
	process.exit(1);
}

const { error: sessionsError, count: sessionsCount } = await supabase
	.from('sessions')
	.upsert(sessionRows, { onConflict: 'session_index', count: 'exact' });
if (sessionsError) {
	console.error('Failed to upsert sessions:', sessionsError.message);
	process.exit(1);
}
console.log(`Upserted ${sessionsCount ?? sessionRows.length} rows into sessions.`);

const { error: wordStateError, count: wordStateCount } = await supabase.from('word_state').upsert(
	words.map((w) => ({ word: w.word, box: w.box, last_session: w.lastSession })),
	{ onConflict: 'word', count: 'exact' }
);
if (wordStateError) {
	console.error('Failed to upsert word_state:', wordStateError.message);
	process.exit(1);
}
console.log(`Upserted ${wordStateCount ?? words.length} rows into word_state.`);
