import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	listUsers,
	listWordListsForUser,
	verifyListOwnership,
	createWordList,
	updateWordList,
	renameListWord,
	ListNameConflictError,
	ListNotFoundError,
	WordNotFoundError,
	WordConflictError
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
		upsert: vi.fn(() => builder),
		update: vi.fn(() => builder),
		delete: vi.fn(() => builder),
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

// renameListWord hits list_words multiple times in sequence (oldRow lookup,
// conflict lookup, upsert, delete, restore-rank), each needing a different
// canned result — a per-table queue consumed in call order, rather than one
// static result per table.
function sequencedSupabase(queuesByTable: Record<string, QueryResult[]>): SupabaseClient {
	const cursors: Record<string, number> = {};
	return {
		from: vi.fn((table: string) => {
			const queue = queuesByTable[table] ?? [];
			const index = cursors[table] ?? 0;
			cursors[table] = index + 1;
			return queryBuilder(queue[index] ?? { data: null, error: null });
		})
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

describe('renameListWord', () => {
	it('runs the full insert -> repoint -> delete -> restore-rank dance in order', async () => {
		const supabase = sequencedSupabase({
			list_words: [
				{ data: { frequency_rank: 5 } }, // oldRow lookup
				{ data: null }, // conflict check: newWord not present
				{ error: null }, // upsert at negative placeholder rank
				{ error: null }, // delete old row
				{ error: null } // restore real rank
			],
			word_state: [{ error: null }],
			vocab_session_attempts: [{ error: null }]
		});

		await expect(renameListWord(supabase, 1, '連れて', 'につれて')).resolves.toBeUndefined();

		// Call order: list_words(oldRow select) -> list_words(conflict select) ->
		// list_words(upsert) -> word_state(update) -> vocab_session_attempts(update)
		// -> list_words(delete) -> list_words(restore-rank update).
		const fromMock = supabase.from as ReturnType<typeof vi.fn>;
		expect(fromMock.mock.results[2].value.upsert).toHaveBeenCalledWith(
			{ list_id: 1, word: 'につれて', frequency_rank: -5 },
			{ onConflict: 'list_id,word' }
		);
		expect(fromMock.mock.results[3].value.update).toHaveBeenCalledWith({ word: 'につれて' });
		expect(fromMock.mock.results[4].value.update).toHaveBeenCalledWith({ word: 'につれて' });
		expect(fromMock.mock.results[6].value.update).toHaveBeenCalledWith({ frequency_rank: 5 });
	});

	it('throws WordNotFoundError when oldWord is not in the list', async () => {
		const supabase = sequencedSupabase({
			list_words: [{ data: null }]
		});

		await expect(renameListWord(supabase, 1, '存在しない', '新しい')).rejects.toThrow(
			WordNotFoundError
		);
	});

	it('throws WordConflictError when newWord already exists in the list', async () => {
		const supabase = sequencedSupabase({
			list_words: [{ data: { frequency_rank: 5 } }, { data: { id: 99 } }]
		});

		await expect(renameListWord(supabase, 1, '連れて', '既存の単語')).rejects.toThrow(
			WordConflictError
		);
	});

	it('rethrows a Supabase error from the initial lookup', async () => {
		const supabase = sequencedSupabase({
			list_words: [{ error: new Error('db down') }]
		});

		await expect(renameListWord(supabase, 1, '連れて', 'につれて')).rejects.toThrow('db down');
	});
});
