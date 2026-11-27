import { readFileSync } from 'node:fs';
import { createAdminClient } from './lib/supabase-admin.ts';
import { toDictionaryRow } from '../src/lib/target-practice/dictionary.ts';
import type { JmdictWord } from '../src/lib/target-practice/dictionary.ts';
import { syncDictionary } from '../src/lib/target-practice/dictionary-sync.ts';
import type { DictionaryStore, StoredRow } from '../src/lib/target-practice/dictionary-sync.ts';

// Loads the JMdict dictionary (the jmdict-simplified English release) into
// dictionary_entries, which target practice's Word lookup reads. Re-runnable:
// compares the file with the table, writes only new and changed entries, then
// deletes entries the file no longer has. A row's dict_version is therefore the
// release that last changed it. JMdict is not updated automatically — download
// a newer release and re-run.
//
// Usage:
//   npm run dictionary:import -- <path to jmdict-eng-*.json>
//   npx tsx --env-file=.env.staging scripts/import-dictionary.ts <path>   (another environment)
// Get the file from https://github.com/scriptin/jmdict-simplified/releases
// (jmdict-eng-<version>.json.tgz, extracted). Licence: see README.md.
const path = process.argv[2];
if (!path) {
	console.error('Usage: npm run dictionary:import -- <path to jmdict-eng-*.json>');
	process.exit(1);
}

const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
	dictDate?: unknown;
	languages?: unknown;
	words?: unknown;
};
if (
	typeof parsed.dictDate !== 'string' ||
	!Array.isArray(parsed.languages) ||
	!parsed.languages.includes('eng') ||
	!Array.isArray(parsed.words)
) {
	console.error('That does not look like a jmdict-simplified English file (jmdict-eng-*.json).');
	process.exit(1);
}
const version = parsed.dictDate;
const rows = (parsed.words as JmdictWord[]).map((word) => toDictionaryRow(word, version));

const supabase = createAdminClient();
// The target host only (never the key), so a wrong env file is visible before the long run.
console.log(
	`Importing ${rows.length} entries (JMdict ${version}) into ${new URL(process.env.SUPABASE_URL!).host}`
);

const store: DictionaryStore = {
	async readAfter(afterId, limit) {
		const { data, error } = await supabase
			.from('dictionary_entries')
			.select('id, common, kanji, kana, senses, lookup_keys')
			.gt('id', afterId)
			.order('id', { ascending: true })
			.limit(limit);
		if (error) throw new Error(error.message);
		return data as StoredRow[];
	},
	async upsert(batch) {
		const { error } = await supabase.from('dictionary_entries').upsert(batch, { onConflict: 'id' });
		if (error) throw new Error(error.message);
	},
	async remove(ids) {
		const { error } = await supabase.from('dictionary_entries').delete().in('id', ids);
		if (error) throw new Error(error.message);
	}
};

try {
	const { added, changed, unchanged, removed } = await syncDictionary(store, rows, {
		log: console.log
	});
	console.log(
		`Done. Added ${added}, changed ${changed}, removed ${removed}, left ${unchanged} unchanged.`
	);
} catch (err) {
	console.error('Import failed:', err instanceof Error ? err.message : err);
	console.error('Run it again to finish: entries already written are skipped.');
	process.exit(1);
}
