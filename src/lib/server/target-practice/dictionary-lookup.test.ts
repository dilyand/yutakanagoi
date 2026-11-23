import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const logError = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('$lib/server/logger', () => ({ logError }));

import { lookupWordInDictionary } from './dictionary-lookup';

const TABERU = {
	id: 1358280,
	common: true,
	kanji: [{ text: '食べる', common: true, tags: [] }],
	kana: [{ text: 'たべる', common: true, tags: [] }],
	senses: [
		{ pos: ['v1', 'vt'], misc: [], glosses: ['to eat'] },
		{ pos: ['v1', 'vt'], misc: [], glosses: ['to live on (e.g. a salary)'] }
	]
};

/** A fake client whose lookup query resolves to `result`, recording what was asked. */
function clientReturning(result: { data: unknown; error: unknown }) {
	const calls = { contains: vi.fn(), order: vi.fn(), limit: vi.fn() };
	const query = {
		select: vi.fn(() => query),
		contains: vi.fn((...args: unknown[]) => (calls.contains(...args), query)),
		order: vi.fn((...args: unknown[]) => (calls.order(...args), query)),
		limit: vi.fn((...args: unknown[]) => (calls.limit(...args), Promise.resolve(result)))
	};
	const from = vi.fn(() => query);
	return { supabase: { from } as unknown as SupabaseClient, from, calls };
}

beforeEach(() => vi.clearAllMocks());

describe('lookupWordInDictionary', () => {
	it('looks the folded input up by exact key, common entries first, and returns candidates', async () => {
		const { supabase, from, calls } = clientReturning({ data: [TABERU], error: null });
		const result = await lookupWordInDictionary(supabase, 'たべる');

		expect(result).toEqual({
			status: 'ok',
			candidates: [{ target: '食べる', reading: 'たべる', gloss: 'to eat' }]
		});
		expect(from).toHaveBeenCalledWith('dictionary_entries');
		expect(calls.contains).toHaveBeenCalledWith('lookup_keys', ['たべる']);
		expect(calls.order).toHaveBeenNthCalledWith(1, 'common', { ascending: false });
		expect(calls.limit).toHaveBeenCalledWith(40);
	});

	it('returns none, without a trace, when nothing matches', async () => {
		const { supabase } = clientReturning({ data: [], error: null });
		expect(await lookupWordInDictionary(supabase, 'ほげほげ')).toEqual({ status: 'none' });
		expect(logError).not.toHaveBeenCalled();
	});

	it('does not query at all for a key with characters the filter could misread', async () => {
		const { supabase, from } = clientReturning({ data: [], error: null });
		expect(await lookupWordInDictionary(supabase, 'a,b}')).toEqual({ status: 'none' });
		expect(from).not.toHaveBeenCalled();
	});

	it('logs when entries matched but none produced a usable candidate', async () => {
		const noGloss = { ...TABERU, senses: [] };
		const { supabase } = clientReturning({ data: [noGloss], error: null });
		expect(await lookupWordInDictionary(supabase, '食べる')).toEqual({ status: 'none' });
		expect(logError).toHaveBeenCalledWith(
			'target-practice/lookup/dictionary',
			expect.any(Error),
			expect.objectContaining({ input: '食べる', matched: 1 })
		);
	});

	it('lets a database failure propagate', async () => {
		const dbError = Object.assign(new Error('db down'), { code: '57P01' });
		const { supabase } = clientReturning({ data: null, error: dbError });
		await expect(lookupWordInDictionary(supabase, '食べる')).rejects.toBe(dbError);
	});
});
