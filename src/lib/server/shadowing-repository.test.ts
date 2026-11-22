import { describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { fetchChunkDetailsWithSignedUrls } from './shadowing-repository';

interface RecordedCall {
	method: string;
	args: unknown[];
}

/**
 * A just-enough fake of supabase-js for fetchChunkDetailsWithSignedUrls: a
 * chainable, awaitable query builder that records every call made on it and
 * resolves to `rows`, plus a storage stub that "signs" any path. It does NOT
 * evaluate the filters — it only records them, so these tests pin which
 * filters the repository applies, not what Postgres does with them (that's
 * covered by running against the local Supabase stack).
 */
function fakeSupabase(rows: unknown[]) {
	const calls: RecordedCall[] = [];
	const builder: Record<string, unknown> = {
		then: (resolve: (value: unknown) => unknown) => resolve({ data: rows, error: null })
	};
	for (const method of ['select', 'eq', 'is', 'not', 'in']) {
		builder[method] = (...args: unknown[]) => {
			calls.push({ method, args });
			return builder;
		};
	}
	const signed: string[] = [];
	const client = {
		from: (table: string) => {
			calls.push({ method: 'from', args: [table] });
			return builder;
		},
		storage: {
			from: () => ({
				createSignedUrl: async (path: string) => {
					signed.push(path);
					return { data: { signedUrl: `https://signed.test/${path}` }, error: null };
				}
			})
		}
	} as unknown as SupabaseClient;
	return { client, calls, signed };
}

function row(chunkId: string) {
	return {
		chunk_id: chunkId,
		audio_path: `u/${chunkId}.m4a`,
		transcript: 't',
		kana: 'k',
		translation: 'x',
		duration_ms: 1000
	};
}

describe('fetchChunkDetailsWithSignedUrls', () => {
	it('returns [] without querying anything for an empty id list', async () => {
		const { client, calls } = fakeSupabase([]);
		expect(await fetchChunkDetailsWithSignedUrls(client, 1, [])).toEqual([]);
		expect(calls).toEqual([]);
	});

	it('only serves this user’s verified, unflagged chunks — the serving gate', async () => {
		const { client, calls } = fakeSupabase([row('a')]);

		await fetchChunkDetailsWithSignedUrls(client, 7, ['a']);

		expect(calls).toContainEqual({ method: 'from', args: ['shadowing_chunks'] });
		expect(calls).toContainEqual({ method: 'eq', args: ['user_id', 7] });
		expect(calls).toContainEqual({ method: 'is', args: ['flagged_at', null] });
		expect(calls).toContainEqual({ method: 'not', args: ['verified_at', 'is', null] });
		expect(calls).toContainEqual({ method: 'in', args: ['chunk_id', ['a']] });
	});

	it('returns details in the order of the requested ids, signing each returned row', async () => {
		// The query doesn't preserve order, so the function must re-order.
		const { client, signed } = fakeSupabase([row('c'), row('a'), row('b')]);

		const details = await fetchChunkDetailsWithSignedUrls(client, 1, ['a', 'b', 'c']);

		expect(details.map((d) => d.chunkId)).toEqual(['a', 'b', 'c']);
		expect(details[0].audioUrl).toBe('https://signed.test/u/a.m4a');
		expect(signed.sort()).toEqual(['u/a.m4a', 'u/b.m4a', 'u/c.m4a']);
	});

	it('omits requested ids the query did not return, rather than failing', async () => {
		const { client } = fakeSupabase([row('b')]);

		const details = await fetchChunkDetailsWithSignedUrls(client, 1, ['a', 'b', 'missing']);

		expect(details.map((d) => d.chunkId)).toEqual(['b']);
	});
});
