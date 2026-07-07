import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { UserNotFoundError, verifyUserExists } from './conjugation-auth';

interface QueryResult {
	data?: unknown;
	error?: unknown;
}

function queryBuilder(result: QueryResult) {
	const builder = {
		select: vi.fn(() => builder),
		eq: vi.fn(() => builder),
		maybeSingle: vi.fn(() => Promise.resolve(result))
	};
	return builder;
}

function fakeSupabase(result: QueryResult): SupabaseClient {
	return {
		from: vi.fn(() => queryBuilder(result))
	} as unknown as SupabaseClient;
}

describe('verifyUserExists', () => {
	it('resolves without throwing when the user exists', async () => {
		const supabase = fakeSupabase({ data: { id: 1 } });
		await expect(verifyUserExists(supabase, 1)).resolves.toBeUndefined();
	});

	it('throws UserNotFoundError when no matching row is found', async () => {
		const supabase = fakeSupabase({ data: null });
		await expect(verifyUserExists(supabase, 1)).rejects.toThrow(UserNotFoundError);
	});

	it('rethrows a Supabase error rather than treating it as not-found', async () => {
		const supabase = fakeSupabase({ error: new Error('db down') });
		await expect(verifyUserExists(supabase, 1)).rejects.toThrow('db down');
	});
});
