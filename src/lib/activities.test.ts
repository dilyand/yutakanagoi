import { describe, expect, it } from 'vitest';
import { ACTIVITIES, getActivity } from './activities';

describe('ACTIVITIES', () => {
	it('is non-empty and includes vocab-drill', () => {
		expect(ACTIVITIES.length).toBeGreaterThan(0);
		expect(ACTIVITIES.some((activity) => activity.id === 'vocab-drill')).toBe(true);
	});
});

describe('getActivity', () => {
	it('returns the matching descriptor', () => {
		expect(getActivity('vocab-drill')).toEqual({
			id: 'vocab-drill',
			label: 'Vocabulary drill',
			description: 'Spaced-repetition Japanese vocab practice.'
		});
	});

	it('returns undefined for an unknown id', () => {
		expect(getActivity('nonexistent')).toBeUndefined();
	});
});
