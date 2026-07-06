import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	listUsers,
	listWordListsForUser,
	verifyListOwnership,
	createWordList,
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
