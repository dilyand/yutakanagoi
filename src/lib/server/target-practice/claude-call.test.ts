import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';

const mockEnv = vi.hoisted(() => ({ TARGET_PRACTICE_ENABLED: undefined as string | undefined }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

const createClient = vi.hoisted(() => vi.fn(() => ({ fake: 'client' })));
vi.mock('$lib/server/claude-shared', () => ({ createClient }));

const logError = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock('$lib/server/logger', () => ({ logError }));

const reserveUsage = vi.hoisted(() => vi.fn());
const recordTokens = vi.hoisted(() => vi.fn());
vi.mock('./usage', async (importOriginal) => ({
	...(await importOriginal<typeof import('./usage')>()),
	reserveUsage,
	recordTokens
}));

import { UsageCapError, callClaude, isTargetPracticeEnabled } from './claude-call';

const supabase = {} as SupabaseClient;
const response = { usage: { input_tokens: 100, output_tokens: 40 }, parsed_output: 'ok' };

beforeEach(() => {
	vi.clearAllMocks();
	mockEnv.TARGET_PRACTICE_ENABLED = undefined;
	reserveUsage.mockResolvedValue(true);
	recordTokens.mockResolvedValue(undefined);
});

describe('isTargetPracticeEnabled', () => {
	it('is on by default and for empty values', () => {
		expect(isTargetPracticeEnabled()).toBe(true);
		mockEnv.TARGET_PRACTICE_ENABLED = '';
		expect(isTargetPracticeEnabled()).toBe(true);
		mockEnv.TARGET_PRACTICE_ENABLED = 'true';
		expect(isTargetPracticeEnabled()).toBe(true);
	});

	it('is off for "false" or "0", case- and whitespace-insensitively', () => {
		for (const v of ['false', 'FALSE', ' false ', '0']) {
			mockEnv.TARGET_PRACTICE_ENABLED = v;
			expect(isTargetPracticeEnabled()).toBe(false);
		}
	});
});

describe('callClaude', () => {
	it('reserves, calls, records tokens, and returns the response untouched', async () => {
		const call = vi.fn().mockResolvedValue(response);
		const result = await callClaude({ supabase, userId: 5, kind: 'lookup', call });

		expect(result).toBe(response);
		expect(reserveUsage).toHaveBeenCalledWith(supabase, 5, 'lookup');
		expect(call).toHaveBeenCalledWith({ fake: 'client' });
		expect(recordTokens).toHaveBeenCalledWith(supabase, 5, { input: 100, output: 40 });
	});

	it('reserves before the call runs', async () => {
		const order: string[] = [];
		reserveUsage.mockImplementation(async () => (order.push('reserve'), true));
		const call = vi.fn(async () => (order.push('call'), response));
		await callClaude({ supabase, userId: 1, kind: 'session', call });
		expect(order).toEqual(['reserve', 'call']);
	});

	it('counts cache tokens as input', async () => {
		const call = vi.fn().mockResolvedValue({
			usage: {
				input_tokens: 10,
				output_tokens: 5,
				cache_creation_input_tokens: 200,
				cache_read_input_tokens: 300
			}
		});
		await callClaude({ supabase, userId: 1, kind: 'ceiling', call });
		expect(recordTokens).toHaveBeenCalledWith(supabase, 1, { input: 510, output: 5 });
	});

	it('passes timeoutMs through to client creation', async () => {
		await callClaude({
			supabase,
			userId: 1,
			kind: 'session',
			timeoutMs: 60_000,
			call: vi.fn().mockResolvedValue(response)
		});
		expect(createClient).toHaveBeenCalledWith({ timeoutMs: 60_000 });
	});

	it('passes maxRetries through (0 is meaningful, not "unset")', async () => {
		await callClaude({
			supabase,
			userId: 1,
			kind: 'session',
			timeoutMs: 50_000,
			maxRetries: 0,
			call: vi.fn().mockResolvedValue(response)
		});
		expect(createClient).toHaveBeenLastCalledWith({ timeoutMs: 50_000, maxRetries: 0 });
	});

	it('throws UsageCapError(cap_reached) without calling Claude when blocked', async () => {
		reserveUsage.mockResolvedValue(false);
		const call = vi.fn();
		const err = await callClaude({ supabase, userId: 1, kind: 'session', call }).catch((e) => e);

		expect(err).toBeInstanceOf(UsageCapError);
		expect(err.reason).toBe('cap_reached');
		expect(err.kind).toBe('session');
		expect(err.resetsAt).toBeInstanceOf(Date);
		expect(call).not.toHaveBeenCalled();
		expect(recordTokens).not.toHaveBeenCalled();
	});

	it('throws UsageCapError(disabled) without reserving or calling when switched off', async () => {
		mockEnv.TARGET_PRACTICE_ENABLED = 'false';
		const call = vi.fn();
		const err = await callClaude({ supabase, userId: 1, kind: 'lookup', call }).catch((e) => e);

		expect(err).toBeInstanceOf(UsageCapError);
		expect(err.reason).toBe('disabled');
		expect(reserveUsage).not.toHaveBeenCalled();
		expect(call).not.toHaveBeenCalled();
	});

	it('propagates a reservation DB error without calling Claude', async () => {
		reserveUsage.mockRejectedValue(new Error('db down'));
		const call = vi.fn();
		await expect(callClaude({ supabase, userId: 1, kind: 'lookup', call })).rejects.toThrow(
			'db down'
		);
		expect(call).not.toHaveBeenCalled();
	});

	it('does not refund or record when the call itself throws', async () => {
		const call = vi.fn().mockRejectedValue(new Error('api down'));
		await expect(callClaude({ supabase, userId: 1, kind: 'lookup', call })).rejects.toThrow(
			'api down'
		);
		expect(reserveUsage).toHaveBeenCalledTimes(1);
		expect(recordTokens).not.toHaveBeenCalled();
	});

	it('still returns the response and logs when recording tokens fails', async () => {
		recordTokens.mockRejectedValue(new Error('record failed'));
		const call = vi.fn().mockResolvedValue(response);
		const result = await callClaude({ supabase, userId: 1, kind: 'lookup', call });
		expect(result).toBe(response);
		expect(logError).toHaveBeenCalledTimes(1);
	});
});
