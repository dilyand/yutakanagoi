import type { DictionaryRow } from './dictionary';

/**
 * Brings dictionary_entries in line with a JMdict release, writing only what
 * differs. Rewriting unchanged rows is not free: Postgres keeps the old row
 * versions, and one full rewrite grew the table about 1.8x for good. Pure apart
 * from the store it is handed, and relative-import only (run by tsx).
 */

/** A row as read back for comparison; the version column is deliberately not compared. */
export type StoredRow = Omit<DictionaryRow, 'dict_version'>;

/** Methods throw on failure. */
export interface DictionaryStore {
	/** Up to `limit` rows with an id above `afterId`, in id order; empty at the end. */
	readAfter(afterId: number, limit: number): Promise<StoredRow[]>;
	upsert(rows: DictionaryRow[]): Promise<void>;
	remove(ids: number[]): Promise<void>;
}

export interface SyncSummary {
	added: number;
	changed: number;
	unchanged: number;
	removed: number;
}

export interface SyncOptions {
	pageSize?: number;
	writeBatch?: number;
	/** Smaller than a write batch: the ids to delete travel in the request URL. */
	deleteBatch?: number;
	log?: (message: string) => void;
}

const PROGRESS_EVERY = 20_000;

/** Everything but the version, as one string. jsonb does not keep object key order. */
export function contentKey(row: StoredRow): string {
	return JSON.stringify(
		[row.common, row.kanji, row.kana, row.senses, row.lookup_keys],
		(_, value: unknown) =>
			value && typeof value === 'object' && !Array.isArray(value)
				? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)))
				: value
	);
}

/**
 * Adds and rewrites first, deletes last, so a run that stops part-way never
 * leaves the table short of an entry it had. Running again finishes the job:
 * whatever was already written compares as unchanged.
 */
export async function syncDictionary(
	store: DictionaryStore,
	rows: DictionaryRow[],
	{ pageSize = 1000, writeBatch = 1000, deleteBatch = 500, log = () => {} }: SyncOptions = {}
): Promise<SyncSummary> {
	// Starts as every incoming row; the unchanged ones drop out as the table is read.
	const toWrite = new Map(rows.map((row) => [row.id, row]));
	const toRemove: number[] = [];
	let changed = 0;
	let unchanged = 0;
	let read = 0;
	let afterId = 0;

	// Ends on an empty page, not a short one: the server may cap pages below pageSize.
	for (;;) {
		const page = await store.readAfter(afterId, pageSize);
		if (page.length === 0) break;
		for (const stored of page) {
			const incoming = toWrite.get(stored.id);
			if (!incoming) {
				toRemove.push(stored.id);
			} else if (contentKey(incoming) === contentKey(stored)) {
				toWrite.delete(stored.id);
				unchanged++;
			} else {
				changed++;
			}
		}
		afterId = page[page.length - 1].id;
		if (Math.floor((read + page.length) / PROGRESS_EVERY) > Math.floor(read / PROGRESS_EVERY)) {
			log(`  compared ${read + page.length} stored entries`);
		}
		read += page.length;
	}

	const writes = [...toWrite.values()];
	const added = writes.length - changed;
	log(
		`${added} to add, ${changed} to change, ${toRemove.length} to remove, ${unchanged} unchanged`
	);

	for (let i = 0; i < writes.length; i += writeBatch) {
		await store.upsert(writes.slice(i, i + writeBatch));
		const done = Math.min(i + writeBatch, writes.length);
		if (done % PROGRESS_EVERY < writeBatch || done === writes.length) {
			log(`  written ${done}/${writes.length}`);
		}
	}
	for (let i = 0; i < toRemove.length; i += deleteBatch) {
		await store.remove(toRemove.slice(i, i + deleteBatch));
	}

	return { added, changed, unchanged, removed: toRemove.length };
}
