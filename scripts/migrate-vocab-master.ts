import { readFileSync } from 'node:fs';
import { parseVocabMaster } from './lib/parse-vocab-files.ts';
import { createAdminClient } from './lib/supabase-admin.ts';

const dryRun = process.argv.includes('--dry-run');

const markdown = readFileSync(new URL('../vocab-master.md', import.meta.url), 'utf-8');
const entries = parseVocabMaster(markdown);

console.log(`Parsed ${entries.length} words from vocab-master.md`);

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
