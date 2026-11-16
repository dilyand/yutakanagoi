import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { USAGE_LIMITS, nextUtcMidnight, recordTokens, reserveUsage } from './usage';

function fakeSupabase(result: { data?: unknown; error?: unknown }) {
	const rpc = vi.fn(() => Promise.resolve(result));
	return { supabase: { rpc } as unknown as SupabaseClient, rpc };
}

describe('reserveUsage', () => {
	it('passes the kind and the configured caps to the RPC', async () => {
		const { supabase, rpc } = fakeSupabase({ data: true });
		await reserveUsage(supabase, 7, 'session');
		expect(rpc).toHaveBeenCalledWith('reserve_target_practice_usage', {
			p_user_id: 7,
			p_kind: 'session',
			p_session_cap: USAGE_LIMITS.sessionsPerDay,
			p_lookup_cap: USAGE_LIMITS.lookupsPerDay,
			p_output_ceiling: USAGE_LIMITS.outputTokensPerDay
		});
	});

	it('returns true only when the RPC returns true', async () => {
		expect(await reserveUsage(fakeSupabase({ data: true }).supabase, 1, 'lookup')).toBe(true);
		expect(await reserveUsage(fakeSupabase({ data: false }).supabase, 1, 'lookup')).toBe(false);
		expect(await reserveUsage(fakeSupabase({ data: null }).supabase, 1, 'lookup')).toBe(false);
	});

	it('throws on a database error instead of failing open', async () => {
		const { supabase } = fakeSupabase({ error: new Error('db down') });
		await expect(reserveUsage(supabase, 1, 'ceiling')).rejects.toThrow('db down');
	});
});

describe('recordTokens', () => {
	it('passes both token counts to the RPC', async () => {
		const { supabase, rpc } = fakeSupabase({});
		await recordTokens(supabase, 3, { input: 120, output: 45 });
		expect(rpc).toHaveBeenCalledWith('record_target_practice_tokens', {
			p_user_id: 3,
			p_input_tokens: 120,
			p_output_tokens: 45
		});
	});

	it('throws on a database error', async () => {
		const { supabase } = fakeSupabase({ error: new Error('boom') });
		await expect(recordTokens(supabase, 3, { input: 1, output: 1 })).rejects.toThrow('boom');
	});
});

describe('nextUtcMidnight', () => {
	it('returns the start of the next UTC day', () => {
		expect(nextUtcMidnight(new Date('2026-10-17T23:59:59Z')).toISOString()).toBe(
			'2026-10-18T00:00:00.000Z'
		);
		expect(nextUtcMidnight(new Date('2026-10-17T00:00:00Z')).toISOString()).toBe(
			'2026-10-18T00:00:00.000Z'
		);
	});

	it('rolls over month and year ends', () => {
		expect(nextUtcMidnight(new Date('2026-12-31T12:00:00Z')).toISOString()).toBe(
			'2027-01-01T00:00:00.000Z'
		);
	});
});
