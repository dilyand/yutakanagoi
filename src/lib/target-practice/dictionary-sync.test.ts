import { describe, expect, it } from 'vitest';
import type { DictionaryRow } from './dictionary';
import { contentKey, syncDictionary } from './dictionary-sync';
import type { DictionaryStore } from './dictionary-sync';

function row(id: number, gloss = `gloss ${id}`, version = '2026-12-01'): DictionaryRow {
	return {
		id,
		common: false,
		kanji: [],
		kana: [{ text: 'かな', common: false, tags: [] }],
		senses: [{ pos: ['n'], misc: [], glosses: [gloss] }],
		lookup_keys: ['かな'],
		dict_version: version
	};
}

function fakeStore(initial: DictionaryRow[], { serverCap = Infinity } = {}) {
	const table = new Map(initial.map((r) => [r.id, r]));
	const calls: string[] = [];
	const store: DictionaryStore = {
		async readAfter(afterId, limit) {
			return [...table.values()]
				.filter((r) => r.id > afterId)
				.sort((a, b) => a.id - b.id)
				.slice(0, Math.min(limit, serverCap));
		},
		async upsert(rows) {
			calls.push(`upsert ${rows.map((r) => r.id).join(',')}`);
			for (const r of rows) table.set(r.id, r);
		},
		async remove(ids) {
			calls.push(`remove ${ids.join(',')}`);
			for (const id of ids) table.delete(id);
		}
	};
	return { store, table, calls };
}

describe('contentKey', () => {
	it('ignores object key order, as jsonb returns keys in its own order', () => {
		const reordered = row(1);
		reordered.senses = [{ glosses: ['gloss 1'], misc: [], pos: ['n'] }];
		expect(contentKey(reordered)).toBe(contentKey(row(1)));
	});

	it('ignores the dictionary version', () => {
		expect(contentKey(row(1, 'a', 'old'))).toBe(contentKey(row(1, 'a', 'new')));
	});

	it.each<[string, Partial<DictionaryRow>]>([
		['common', { common: true }],
		['kanji', { kanji: [{ text: '仮名', common: false, tags: [] }] }],
		['kana', { kana: [{ text: 'かな', common: true, tags: [] }] }],
		['senses', { senses: [{ pos: ['n'], misc: ['uk'], glosses: ['gloss 1'] }] }],
		['lookup_keys', { lookup_keys: ['かな', 'カナ'] }]
	])('sees a change in %s', (_, change) => {
		expect(contentKey({ ...row(1), ...change })).not.toBe(contentKey(row(1)));
	});

	it('sees a change in array order', () => {
		const a = { ...row(1), lookup_keys: ['あ', 'い'] };
		const b = { ...row(1), lookup_keys: ['い', 'あ'] };
		expect(contentKey(a)).not.toBe(contentKey(b));
	});
});

describe('syncDictionary', () => {
	it('fills an empty table in batches', async () => {
		const { store, table, calls } = fakeStore([]);
		const summary = await syncDictionary(store, [row(1), row(2), row(3)], { writeBatch: 2 });
		expect(summary).toEqual({ added: 3, changed: 0, unchanged: 0, removed: 0 });
		expect(calls).toEqual(['upsert 1,2', 'upsert 3']);
		expect(table.size).toBe(3);
	});

	it('writes nothing when only the version differs', async () => {
		const { store, table, calls } = fakeStore([row(1, 'a', 'old'), row(2, 'b', 'old')]);
		const summary = await syncDictionary(store, [row(1, 'a', 'new'), row(2, 'b', 'new')]);
		expect(summary).toEqual({ added: 0, changed: 0, unchanged: 2, removed: 0 });
		expect(calls).toEqual([]);
		expect(table.get(1)?.dict_version).toBe('old');
	});

	it('writes only new and changed entries, then removes absent ones', async () => {
		const { store, table, calls } = fakeStore([
			row(1, 'same', 'old'),
			row(2, 'before', 'old'),
			row(3, 'gone', 'old')
		]);
		const summary = await syncDictionary(store, [row(1, 'same'), row(2, 'after'), row(4, 'fresh')]);
		expect(summary).toEqual({ added: 1, changed: 1, unchanged: 1, removed: 1 });
		expect(calls).toEqual(['upsert 2,4', 'remove 3']);
		expect([...table.keys()].sort()).toEqual([1, 2, 4]);
		expect(table.get(1)?.dict_version).toBe('old');
		expect(table.get(2)?.dict_version).toBe('2026-12-01');
	});

	it('reads the whole table even when the server caps pages below the page size', async () => {
		const rows = [row(1), row(2), row(3), row(4), row(5)];
		const { store, calls } = fakeStore(rows, { serverCap: 2 });
		const summary = await syncDictionary(store, rows, { pageSize: 1000 });
		expect(summary).toEqual({ added: 0, changed: 0, unchanged: 5, removed: 0 });
		expect(calls).toEqual([]);
	});

	it('removes in batches', async () => {
		const { store, calls } = fakeStore([row(1), row(2), row(3)]);
		await syncDictionary(store, [], { deleteBatch: 2 });
		expect(calls).toEqual(['remove 1,2', 'remove 3']);
	});

	it('removes nothing when a write fails, and finishes on the next run', async () => {
		const { store, table, calls } = fakeStore([row(9, 'gone')]);
		const incoming = [row(1), row(2)];
		let upserts = 0;
		const failing: DictionaryStore = {
			...store,
			async upsert(rows) {
				if (++upserts === 2) throw new Error('fetch failed');
				await store.upsert(rows);
			}
		};
		await expect(syncDictionary(failing, incoming, { writeBatch: 1 })).rejects.toThrow(
			'fetch failed'
		);
		expect([...table.keys()].sort()).toEqual([1, 9]);

		calls.length = 0;
		const summary = await syncDictionary(store, incoming);
		expect(summary).toEqual({ added: 1, changed: 0, unchanged: 1, removed: 1 });
		expect(calls).toEqual(['upsert 2', 'remove 9']);
	});
});
