import { readFileSync } from 'node:fs';
import { createAdminClient } from './lib/supabase-admin.ts';
import { toDictionaryRow } from '../src/lib/target-practice/dictionary.ts';
import type { JmdictWord } from '../src/lib/target-practice/dictionary.ts';
import { syncDictionary } from '../src/lib/target-practice/dictionary-sync.ts';
import type { DictionaryStore, StoredRow } from '../src/lib/target-practice/dictionary-sync.ts';
import { withRetry } from '../src/lib/server/retry.ts';

// Loads the JMdict dictionary (the jmdict-simplified English release) into
// dictionary_entries, which target practice's Word lookup reads. Re-runnable:
// compares the file with the table, writes only new and changed entries, then
// deletes entries the file no longer has. A row's dict_version is therefore the
// release that last changed it. Failed requests are retried. JMdict is not
// updated automatically — download a newer release and re-run.
//
// Usage:
//   npm run dictionary:import -- <path to jmdict-eng-*.json>
//   npx tsx --env-file=.env.staging scripts/import-dictionary.ts <path>   (another environment)
// Get the file from https://github.com/scriptin/jmdict-simplified/releases
// (jmdict-eng-<version>.json.tgz, extracted). Licence: see README.md.

// A long import over a free-tier connection does hit dropped requests: wait out
// up to about a minute of failures per request before giving up.
const RETRY = { retries: 6, delayMs: 10_000 };

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

/**
 * One database request. Every one here is safe to repeat (a read, an upsert by
 * id, a delete by id), so any failure is retried. supabase-js returns errors
 * rather than throwing them, and `withRetry` retries only thrown errors without
 * a `code`, hence the plain Error.
 */
function request<T>(
	what: string,
	run: () => PromiseLike<{ data: T; error: { message: string } | null }>
): Promise<T> {
	return withRetry(async () => {
		const { data, error } = await run();
		if (error) {
			console.warn(`  ${what} failed: ${error.message}`);
			throw new Error(error.message);
		}
		return data;
	}, RETRY);
}

const store: DictionaryStore = {
	async readAfter(afterId, limit) {
		const data = await request(`reading entries after ${afterId}`, () =>
			supabase
				.from('dictionary_entries')
				.select('id, common, kanji, kana, senses, lookup_keys')
				.gt('id', afterId)
				.order('id', { ascending: true })
				.limit(limit)
		);
		return data as StoredRow[];
	},
	async upsert(batch) {
		await request(`writing ${batch.length} entries from ${batch[0].id}`, () =>
			supabase.from('dictionary_entries').upsert(batch, { onConflict: 'id' })
		);
	},
	async remove(ids) {
		await request(`removing ${ids.length} entries from ${ids[0]}`, () =>
			supabase.from('dictionary_entries').delete().in('id', ids)
		);
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
