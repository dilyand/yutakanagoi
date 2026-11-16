import { describe, expect, it } from 'vitest';
import { formatLimitMessage } from './limit-message';
import type { LimitOutcome } from './lookup';

const cap: LimitOutcome = {
	status: 'limit',
	reason: 'cap_reached',
	resetsAt: '2026-10-18T00:00:00.000Z',
	message: 'Daily usage limit reached — it resets at 00:00 UTC.'
};

describe('formatLimitMessage', () => {
	it('shows the reset in the given time zone instead of UTC', () => {
		const text = formatLimitMessage(cap, 'en-GB', 'Asia/Tokyo');
		expect(text).toContain('Daily usage limit reached');
		expect(text).toContain('09:00');
		expect(text).not.toContain('UTC');
	});

	it('leaves the kill-switch message and unparseable dates alone', () => {
		const off: LimitOutcome = { ...cap, reason: 'disabled', message: 'Switched off.' };
		expect(formatLimitMessage(off)).toBe('Switched off.');
		expect(formatLimitMessage({ ...cap, resetsAt: 'nope' })).toBe(cap.message);
	});
});
