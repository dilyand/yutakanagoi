import { readFileSync } from 'node:fs';
import { createAdminClient } from './lib/supabase-admin.ts';
import { toDictionaryRow } from '../src/lib/target-practice/dictionary.ts';
import type { JmdictWord } from '../src/lib/target-practice/dictionary.ts';

// Loads the JMdict dictionary (the jmdict-simplified English release) into
// dictionary_entries, which target practice's Word lookup reads. Re-runnable:
// upserts by id, then deletes rows left over from an older dictionary version.
// JMdict is not updated automatically — download a newer release and re-run.
//
// Usage:
//   npm run dictionary:import -- <path to jmdict-eng-*.json>
//   npx tsx --env-file=.env.staging scripts/import-dictionary.ts <path>   (another environment)
// Get the file from https://github.com/scriptin/jmdict-simplified/releases
// (jmdict-eng-<version>.json.tgz, extracted). Licence: see README.md.
const BATCH_SIZE = 1000;

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
const words = parsed.words as JmdictWord[];

const supabase = createAdminClient();
// The target host only (never the key), so a wrong env file is visible before the long run.
console.log(
	`Importing ${words.length} entries (JMdict ${version}) into ${new URL(process.env.SUPABASE_URL!).host}`
);

let done = 0;
for (let i = 0; i < words.length; i += BATCH_SIZE) {
	const rows = words.slice(i, i + BATCH_SIZE).map((w) => toDictionaryRow(w, version));
	const { error } = await supabase.from('dictionary_entries').upsert(rows, { onConflict: 'id' });
	if (error) {
		console.error(`Batch starting at ${i} failed:`, error.message);
		process.exit(1);
	}
	done += rows.length;
	if (done % 20000 < BATCH_SIZE || done === words.length) console.log(`  ${done}/${words.length}`);
}

const { error: pruneError, count } = await supabase
	.from('dictionary_entries')
	.delete({ count: 'exact' })
	.neq('dict_version', version);
if (pruneError) {
	console.error('Imported, but removing rows from older versions failed:', pruneError.message);
	process.exit(1);
}
console.log(`Done. Removed ${count ?? 0} rows from older dictionary versions.`);
