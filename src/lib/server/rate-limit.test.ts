import { describe, expect, it, vi } from 'vitest';
import { checkRateLimit } from './rate-limit';

describe('checkRateLimit', () => {
	it('allows requests up to the limit and rejects the next one', () => {
		const key = `test-${Math.random()}`;
		expect(checkRateLimit(key, 3, 1000)).toBe(true);
		expect(checkRateLimit(key, 3, 1000)).toBe(true);
		expect(checkRateLimit(key, 3, 1000)).toBe(true);
		expect(checkRateLimit(key, 3, 1000)).toBe(false);
	});

	it('tracks separate keys independently', () => {
		const keyA = `test-a-${Math.random()}`;
		const keyB = `test-b-${Math.random()}`;
		expect(checkRateLimit(keyA, 1, 1000)).toBe(true);
		expect(checkRateLimit(keyA, 1, 1000)).toBe(false);
		expect(checkRateLimit(keyB, 1, 1000)).toBe(true);
	});

	it('resets the window once it elapses', () => {
		vi.useFakeTimers();
		try {
			const key = `test-reset-${Math.random()}`;
			expect(checkRateLimit(key, 1, 1000)).toBe(true);
			expect(checkRateLimit(key, 1, 1000)).toBe(false);
			vi.advanceTimersByTime(1001);
			expect(checkRateLimit(key, 1, 1000)).toBe(true);
		} finally {
			vi.useRealTimers();
		}
	});
});
