import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSession, verifySession, deleteSession } from './session';

interface QueryResult {
	data?: unknown;
	error?: unknown;
}

// A minimal stand-in for Supabase's fluent query builder: every non-terminal
// method returns the same builder so any chain shape works, and the builder
// itself is thenable (matching the real builder, which withRetry relies on
// being a PromiseLike — see retry.ts) so it resolves to `result` whether the
// caller awaits after .insert(...)/.delete(...) directly or after further
// chaining into .maybeSingle().
function queryBuilder(result: QueryResult) {
	const builder = {
		select: vi.fn(() => builder),
		eq: vi.fn(() => builder),
		gt: vi.fn(() => builder),
		insert: vi.fn(() => builder),
		delete: vi.fn(() => builder),
		maybeSingle: vi.fn(() => Promise.resolve(result)),
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

describe('createSession', () => {
	it('inserts a session row and returns a fresh token', async () => {
		const supabase = fakeSupabase({ sessions: { error: null } });
		const { token, expiresAt } = await createSession(supabase, 1);

		expect(token).toMatch(/^[\w-]+$/);
		expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
	});

	it('rethrows a Supabase error', async () => {
		const supabase = fakeSupabase({ sessions: { error: new Error('insert failed') } });
		await expect(createSession(supabase, 1)).rejects.toThrow('insert failed');
	});
});

describe('verifySession', () => {
	it('returns the user for a valid, unexpired token', async () => {
		const supabase = {
			from: vi.fn((table: string) => {
				if (table === 'sessions') return queryBuilder({ data: { user_id: 1 } });
				if (table === 'users') return queryBuilder({ data: { id: 1, username: 'alice' } });
				throw new Error(`unexpected table ${table}`);
			})
		} as unknown as SupabaseClient;

		await expect(verifySession(supabase, 'some-token')).resolves.toEqual({
			userId: 1,
			username: 'alice'
		});
	});

	it('returns null when no session row matches (unknown/expired token)', async () => {
		const supabase = fakeSupabase({ sessions: { data: null } });
		await expect(verifySession(supabase, 'bad-token')).resolves.toBeNull();
	});

	it('returns null when the session references a since-deleted user', async () => {
		const supabase = {
			from: vi.fn((table: string) => {
				if (table === 'sessions') return queryBuilder({ data: { user_id: 1 } });
				if (table === 'users') return queryBuilder({ data: null });
				throw new Error(`unexpected table ${table}`);
			})
		} as unknown as SupabaseClient;

		await expect(verifySession(supabase, 'some-token')).resolves.toBeNull();
	});

	it('rethrows a Supabase error from the session lookup', async () => {
		const supabase = fakeSupabase({ sessions: { error: new Error('db down') } });
		await expect(verifySession(supabase, 'some-token')).rejects.toThrow('db down');
	});
});

describe('deleteSession', () => {
	it('resolves without throwing on success', async () => {
		const supabase = fakeSupabase({ sessions: { error: null } });
		await expect(deleteSession(supabase, 'some-token')).resolves.toBeUndefined();
	});

	it('rethrows a Supabase error', async () => {
		const supabase = fakeSupabase({ sessions: { error: new Error('delete failed') } });
		await expect(deleteSession(supabase, 'some-token')).rejects.toThrow('delete failed');
	});
});
