import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	listUsers,
	listWordListsForUser,
	verifyListOwnership,
	createWordList,
	updateWordList,
	ListNameConflictError,
	ListNotFoundError
} from './user-list-repository';

interface QueryResult {
	data?: unknown;
	error?: unknown;
}

// A minimal stand-in for Supabase's fluent query builder: every non-terminal
// method returns the same builder so any chain shape works, and the builder
// itself is thenable (matching the real builder, which withRetry relies on
// being a PromiseLike — see retry.ts) so it resolves to `result` whether the
// caller awaits after .insert(...) directly or after further chaining.
function queryBuilder(result: QueryResult) {
	const builder = {
		select: vi.fn(() => builder),
		eq: vi.fn(() => builder),
		order: vi.fn(() => builder),
		insert: vi.fn(() => builder),
		maybeSingle: vi.fn(() => Promise.resolve(result)),
		single: vi.fn(() => Promise.resolve(result)),
		then: (
			onFulfilled: (value: QueryResult) => unknown,
			onRejected?: (reason: unknown) => unknown
		) => Promise.resolve(result).then(onFulfilled, onRejected)
	};
	return builder;
}

function fakeSupabase(responsesByTable: Record<string, QueryResult>): SupabaseClient {
	return {
		from: vi.fn((table: string) => queryBuilder(responsesByTable[table]))
	} as unknown as SupabaseClient;
}

describe('listUsers', () => {
	it('returns the rows from the users table', async () => {
		const users = [{ id: 1, username: 'alice' }];
		const supabase = fakeSupabase({ users: { data: users } });
		expect(await listUsers(supabase)).toEqual(users);
	});

	it('rethrows a Supabase error', async () => {
		const supabase = fakeSupabase({ users: { error: new Error('boom') } });
		await expect(listUsers(supabase)).rejects.toThrow('boom');
	});
});

describe('listWordListsForUser', () => {
	it('returns the rows from the word_lists table', async () => {
		const lists = [{ id: 1, name: 'my-list.txt' }];
		const supabase = fakeSupabase({ word_lists: { data: lists } });
		expect(await listWordListsForUser(supabase, 1)).toEqual(lists);
	});
});

describe('verifyListOwnership', () => {
	it('resolves without throwing when the list belongs to the user', async () => {
		const supabase = fakeSupabase({ word_lists: { data: { id: 1 } } });
		await expect(verifyListOwnership(supabase, 1, 1)).resolves.toBeUndefined();
	});

	it('throws ListNotFoundError when no matching row is found', async () => {
		const supabase = fakeSupabase({ word_lists: { data: null } });
		await expect(verifyListOwnership(supabase, 1, 1)).rejects.toThrow(ListNotFoundError);
	});

	it('rethrows a Supabase error rather than treating it as not-found', async () => {
		const supabase = fakeSupabase({ word_lists: { error: new Error('db down') } });
		await expect(verifyListOwnership(supabase, 1, 1)).rejects.toThrow('db down');
	});
});

describe('createWordList', () => {
	it('creates the list and its words, returning the new list id', async () => {
		const listWordsBuilder = queryBuilder({ error: null });
		const supabase = {
			from: vi.fn((table: string) => {
				if (table === 'word_lists') return queryBuilder({ data: { id: 42 } });
				if (table === 'list_words') return listWordsBuilder;
				throw new Error(`unexpected table ${table}`);
			})
		} as unknown as SupabaseClient;

		const listId = await createWordList(supabase, 1, 'my-list.txt', ['一', '二', '三']);

		expect(listId).toBe(42);
		expect(listWordsBuilder.insert).toHaveBeenCalledWith([
			{ list_id: 42, word: '一', frequency_rank: 1 },
			{ list_id: 42, word: '二', frequency_rank: 2 },
			{ list_id: 42, word: '三', frequency_rank: 3 }
		]);
	});

	it('throws ListNameConflictError on a unique_violation from word_lists', async () => {
		const supabase = fakeSupabase({
			word_lists: { error: { code: '23505', message: 'duplicate' } }
		});
		await expect(createWordList(supabase, 1, 'dup.txt', ['a'])).rejects.toThrow(
			ListNameConflictError
		);
	});

	it('rethrows a non-conflict error from word_lists as-is', async () => {
		const supabase = fakeSupabase({ word_lists: { error: { code: '42501', message: 'denied' } } });
		await expect(createWordList(supabase, 1, 'x.txt', ['a'])).rejects.toMatchObject({
			code: '42501'
		});
	});

	it('rethrows an error from inserting list_words', async () => {
		const supabase = {
			from: vi.fn((table: string) => {
				if (table === 'word_lists') return queryBuilder({ data: { id: 42 } });
				if (table === 'list_words')
					return queryBuilder({ error: new Error('words insert failed') });
				throw new Error(`unexpected table ${table}`);
			})
		} as unknown as SupabaseClient;

		await expect(createWordList(supabase, 1, 'x.txt', ['a'])).rejects.toThrow(
			'words insert failed'
		);
	});
});

describe('updateWordList', () => {
	it('appends only the words not already in the list, past the current max rank', async () => {
		const listWordsSelectBuilder = queryBuilder({
			data: [
				{ word: '一', frequency_rank: 1 },
				{ word: '二', frequency_rank: 5 }
			]
		});
		const listWordsInsertBuilder = queryBuilder({ error: null });
		let listWordsCall = 0;
		const supabase = {
			from: vi.fn((table: string) => {
				if (table === 'word_lists') return queryBuilder({ data: { id: 42 } });
				if (table === 'list_words') {
					listWordsCall += 1;
					return listWordsCall === 1 ? listWordsSelectBuilder : listWordsInsertBuilder;
				}
				throw new Error(`unexpected table ${table}`);
			})
		} as unknown as SupabaseClient;

		const result = await updateWordList(supabase, 1, 'my-list.txt', ['一', '三', '四']);

		expect(result).toEqual({ listId: 42, addedCount: 2 });
		expect(listWordsInsertBuilder.insert).toHaveBeenCalledWith([
			{ list_id: 42, word: '三', frequency_rank: 6 },
			{ list_id: 42, word: '四', frequency_rank: 7 }
		]);
	});

	it('de-duplicates repeated words within the uploaded list itself', async () => {
		const listWordsSelectBuilder = queryBuilder({ data: [{ word: '一', frequency_rank: 1 }] });
		const listWordsInsertBuilder = queryBuilder({ error: null });
		let listWordsCall = 0;
		const supabase = {
			from: vi.fn((table: string) => {
				if (table === 'word_lists') return queryBuilder({ data: { id: 42 } });
				if (table === 'list_words') {
					listWordsCall += 1;
					return listWordsCall === 1 ? listWordsSelectBuilder : listWordsInsertBuilder;
				}
				throw new Error(`unexpected table ${table}`);
			})
		} as unknown as SupabaseClient;

		const result = await updateWordList(supabase, 1, 'my-list.txt', ['三', '三']);

		expect(result).toEqual({ listId: 42, addedCount: 1 });
		expect(listWordsInsertBuilder.insert).toHaveBeenCalledWith([
			{ list_id: 42, word: '三', frequency_rank: 2 }
		]);
	});

	it('returns addedCount 0 without inserting when every word is already present', async () => {
		const listWordsSelectBuilder = queryBuilder({ data: [{ word: '一', frequency_rank: 1 }] });
		const supabase = {
			from: vi.fn((table: string) => {
				if (table === 'word_lists') return queryBuilder({ data: { id: 42 } });
				if (table === 'list_words') return listWordsSelectBuilder;
				throw new Error(`unexpected table ${table}`);
			})
		} as unknown as SupabaseClient;

		const result = await updateWordList(supabase, 1, 'my-list.txt', ['一']);

		expect(result).toEqual({ listId: 42, addedCount: 0 });
		expect(listWordsSelectBuilder.insert).not.toHaveBeenCalled();
	});

	it('throws ListNotFoundError when no list matches (userId, name)', async () => {
		const supabase = fakeSupabase({ word_lists: { data: null } });
		await expect(updateWordList(supabase, 1, 'missing.txt', ['a'])).rejects.toThrow(
			ListNotFoundError
		);
	});

	it('rethrows a Supabase error from the word_lists lookup', async () => {
		const supabase = fakeSupabase({ word_lists: { error: new Error('db down') } });
		await expect(updateWordList(supabase, 1, 'my-list.txt', ['a'])).rejects.toThrow('db down');
	});

	it('rethrows a Supabase error from the list_words select', async () => {
		const listWordsSelectBuilder = queryBuilder({ error: new Error('select failed') });
		const supabase = {
			from: vi.fn((table: string) => {
				if (table === 'word_lists') return queryBuilder({ data: { id: 42 } });
				if (table === 'list_words') return listWordsSelectBuilder;
				throw new Error(`unexpected table ${table}`);
			})
		} as unknown as SupabaseClient;

		await expect(updateWordList(supabase, 1, 'my-list.txt', ['a'])).rejects.toThrow(
			'select failed'
		);
	});

	it('rethrows a Supabase error from the list_words insert', async () => {
		const listWordsSelectBuilder = queryBuilder({ data: [] });
		const listWordsInsertBuilder = queryBuilder({ error: new Error('insert failed') });
		let listWordsCall = 0;
		const supabase = {
			from: vi.fn((table: string) => {
				if (table === 'word_lists') return queryBuilder({ data: { id: 42 } });
				if (table === 'list_words') {
					listWordsCall += 1;
					return listWordsCall === 1 ? listWordsSelectBuilder : listWordsInsertBuilder;
				}
				throw new Error(`unexpected table ${table}`);
			})
		} as unknown as SupabaseClient;

		await expect(updateWordList(supabase, 1, 'my-list.txt', ['a'])).rejects.toThrow(
			'insert failed'
		);
	});
});
