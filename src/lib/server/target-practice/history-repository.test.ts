import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
	HISTORY_LIMIT,
	deleteRecentTarget,
	listRecentTargets,
	recordPracticedTarget
} from './history-repository';
import { grammarKakadouka, wordKibishii } from '$lib/target-practice/fixtures';

interface QueryResult {
	data?: unknown;
	error?: unknown;
}

// Thenable fluent builder, like user-list-repository.test.ts; one canned result
// per query, consumed in call order, with every builder call recorded.
function fakeSupabase(results: QueryResult[]) {
	const calls: { method: string; args: unknown[] }[][] = [];
	let i = 0;
	const from = vi.fn(() => {
		const result = results[i++] ?? { data: null, error: null };
		const chain: { method: string; args: unknown[] }[] = [];
		calls.push(chain);
		const builder: Record<string, unknown> = {
			then: (ok: (v: QueryResult) => unknown, bad?: (r: unknown) => unknown) =>
				Promise.resolve(result).then(ok, bad)
		};
		for (const method of ['select', 'eq', 'lt', 'order', 'limit', 'range', 'upsert', 'delete']) {
			builder[method] = (...args: unknown[]) => (chain.push({ method, args }), builder);
		}
		return builder;
	});
	return { supabase: { from } as unknown as SupabaseClient, calls, from };
}

const names = (chain: { method: string }[]) => chain.map((c) => c.method);

describe('listRecentTargets', () => {
	it('returns valid rows newest-first, mapped to RecentTarget', async () => {
		const { supabase, calls } = fakeSupabase([
			{
				data: [
					{
						type: 'grammar',
						target_key: '〜かどうか',
						card: grammarKakadouka.card,
						last_practiced_at: '2026-10-17T10:00:00Z'
					}
				]
			}
		]);
		expect(await listRecentTargets(supabase, 3)).toEqual([
			{
				type: 'grammar',
				targetKey: '〜かどうか',
				card: grammarKakadouka.card,
				lastPracticedAt: '2026-10-17T10:00:00Z'
			}
		]);
		expect(calls[0]).toContainEqual({ method: 'eq', args: ['user_id', 3] });
		expect(calls[0]).toContainEqual({
			method: 'order',
			args: ['last_practiced_at', { ascending: false }]
		});
		expect(calls[0]).toContainEqual({ method: 'limit', args: [8] });
	});

	it('drops rows whose stored card no longer validates, or whose type is unknown', async () => {
		const { supabase } = fakeSupabase([
			{
				data: [
					{
						type: 'word',
						target_key: 'a',
						card: { ok: true, type: 'word' },
						last_practiced_at: 'x'
					},
					{ type: 'haiku', target_key: 'b', card: wordKibishii.card, last_practiced_at: 'x' },
					{ type: 'word', target_key: 'c', card: wordKibishii.card, last_practiced_at: 'x' }
				]
			}
		]);
		expect((await listRecentTargets(supabase, 3)).map((r) => r.targetKey)).toEqual(['c']);
	});

	it('throws on a database error', async () => {
		const { supabase } = fakeSupabase([{ error: { code: '42P01', message: 'nope' } }]);
		await expect(listRecentTargets(supabase, 3)).rejects.toMatchObject({ code: '42P01' });
	});
});

describe('recordPracticedTarget', () => {
	it('upserts keyed on (user, type, target_key) with a fresh timestamp, then skips pruning under the limit', async () => {
		const { supabase, calls, from } = fakeSupabase([{}, { data: [] }]);
		await recordPracticedTarget(supabase, 3, wordKibishii.card);

		const [upsertArgs, options] = calls[0].find((c) => c.method === 'upsert')!.args as [
			Record<string, unknown>,
			unknown
		];
		expect(upsertArgs).toMatchObject({
			user_id: 3,
			type: 'word',
			target_key: '厳しい|きびしい',
			card: wordKibishii.card
		});
		expect(Date.parse(upsertArgs.last_practiced_at as string)).not.toBeNaN();
		expect(options).toEqual({ onConflict: 'user_id,type,target_key' });
		expect(from).toHaveBeenCalledTimes(2); // upsert + cutoff lookup, no delete
		expect(calls[1]).toContainEqual({
			method: 'range',
			args: [HISTORY_LIMIT - 1, HISTORY_LIMIT - 1]
		});
	});

	it('prunes rows older than the 30th-newest', async () => {
		const { supabase, calls } = fakeSupabase([
			{},
			{ data: [{ last_practiced_at: '2026-10-01T00:00:00Z' }] },
			{}
		]);
		await recordPracticedTarget(supabase, 3, grammarKakadouka.card);
		expect(names(calls[2])).toEqual(['delete', 'eq', 'lt']);
		expect(calls[2]).toContainEqual({
			method: 'lt',
			args: ['last_practiced_at', '2026-10-01T00:00:00Z']
		});
		expect(calls[2]).toContainEqual({ method: 'eq', args: ['user_id', 3] });
	});

	it('throws if the upsert fails, before touching the prune', async () => {
		const { supabase, from } = fakeSupabase([{ error: { code: '23503', message: 'fk' } }]);
		await expect(recordPracticedTarget(supabase, 3, grammarKakadouka.card)).rejects.toMatchObject({
			code: '23503'
		});
		expect(from).toHaveBeenCalledTimes(1);
	});
});

describe('deleteRecentTarget', () => {
	it('deletes by user, type and key', async () => {
		const { supabase, calls } = fakeSupabase([{}]);
		await deleteRecentTarget(supabase, 3, 'grammar', '〜かどうか');
		expect(calls[0]).toContainEqual({ method: 'eq', args: ['type', 'grammar'] });
		expect(calls[0]).toContainEqual({ method: 'eq', args: ['target_key', '〜かどうか'] });
		expect(calls[0]).toContainEqual({ method: 'eq', args: ['user_id', 3] });
	});
});
