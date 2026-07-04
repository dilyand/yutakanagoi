// Historical: this seeded the 0.1.0-era global `vocab_master` table, which
// 0.2.0's migrate-legacy-user-list.ts reads from directly (then drops) —
// kept here for reference, not part of the 0.2.0 migration path.
import { readFileSync } from 'node:fs';
import { parseVocabMaster } from './lib/parse-vocab-files.ts';
import { createAdminClient } from './lib/supabase-admin.ts';

const dryRun = process.argv.includes('--dry-run');

const markdown = readFileSync(
	new URL('../japanese-2000-most-frequent-words.md', import.meta.url),
	'utf-8'
);
const entries = parseVocabMaster(markdown);

console.log(`Parsed ${entries.length} words from japanese-2000-most-frequent-words.md`);

if (dryRun) {
	console.log('--dry-run: not writing to Supabase. First 5 and last 5 entries:');
	console.table([...entries.slice(0, 5), ...entries.slice(-5)]);
	process.exit(0);
}

const supabase = createAdminClient();

const { error, count } = await supabase.from('vocab_master').upsert(
	entries.map((e) => ({ word: e.word, frequency_rank: e.frequencyRank })),
	{ onConflict: 'word', count: 'exact' }
);

if (error) {
	console.error('Migration failed:', error.message);
	process.exit(1);
}

console.log(`Upserted ${count ?? entries.length} rows into vocab_master.`);
