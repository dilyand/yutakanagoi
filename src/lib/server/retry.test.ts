import { describe, expect, it, vi } from 'vitest';
import { withRetry } from './retry';

describe('withRetry', () => {
	it('returns the result on first success without retrying', async () => {
		const fn = vi.fn().mockResolvedValue('ok');
		const result = await withRetry(fn, { delayMs: 1 });
		expect(result).toBe('ok');
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('retries on a transient error (no .code) and eventually succeeds', async () => {
		const fn = vi.fn().mockRejectedValueOnce(new Error('network blip')).mockResolvedValue('ok');
		const result = await withRetry(fn, { delayMs: 1 });
		expect(result).toBe('ok');
		expect(fn).toHaveBeenCalledTimes(2);
	});

	it('gives up after exhausting retries on a persistent transient error', async () => {
		const fn = vi.fn().mockRejectedValue(new Error('still down'));
		await expect(withRetry(fn, { retries: 2, delayMs: 1 })).rejects.toThrow('still down');
		expect(fn).toHaveBeenCalledTimes(3);
	});

	it('rethrows a non-transient error (has .code) immediately without retrying', async () => {
		const pgError = Object.assign(new Error('unique violation'), { code: '23505' });
		const fn = vi.fn().mockRejectedValue(pgError);
		await expect(withRetry(fn, { delayMs: 1 })).rejects.toBe(pgError);
		expect(fn).toHaveBeenCalledTimes(1);
	});
});
