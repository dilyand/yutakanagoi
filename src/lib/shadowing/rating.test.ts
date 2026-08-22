import { describe, expect, it } from 'vitest';
import { applyShadowingOutcome, ratingForHintLevel } from './rating';

describe('ratingForHintLevel', () => {
	it('maps hint levels to ratings per the ladder', () => {
		expect(ratingForHintLevel(0)).toBe('easy');
		expect(ratingForHintLevel(1)).toBe('good');
		expect(ratingForHintLevel(2)).toBe('hard');
		expect(ratingForHintLevel(3)).toBe('very_hard');
	});
});

describe('applyShadowingOutcome', () => {
	it('jumps a brand-new chunk straight to box 4 on easy', () => {
		const result = applyShadowingOutcome({ box: undefined, rating: 'easy', sessionIndex: 1 });
		expect(result.box).toBe(4);
		expect(result.box4Streak).toBe(0);
	});

	it('starts a brand-new chunk at box 1 on good', () => {
		const result = applyShadowingOutcome({ box: undefined, rating: 'good', sessionIndex: 1 });
		expect(result.box).toBe(1);
	});

	it('starts a brand-new chunk at box 0 on hard or very_hard', () => {
		expect(applyShadowingOutcome({ box: undefined, rating: 'hard', sessionIndex: 1 }).box).toBe(0);
		expect(
			applyShadowingOutcome({ box: undefined, rating: 'very_hard', sessionIndex: 1 }).box
		).toBe(0);
	});

	it('advances an existing chunk by one box on easy or good', () => {
		expect(applyShadowingOutcome({ box: 1, rating: 'easy', sessionIndex: 2 }).box).toBe(2);
		expect(applyShadowingOutcome({ box: 1, rating: 'good', sessionIndex: 2 }).box).toBe(2);
	});

	it('caps advancement at box 4', () => {
		expect(applyShadowingOutcome({ box: 4, rating: 'easy', sessionIndex: 2 }).box).toBe(4);
	});

	it('drops an existing chunk by one box on hard, floored at 0', () => {
		expect(applyShadowingOutcome({ box: 2, rating: 'hard', sessionIndex: 2 }).box).toBe(1);
		expect(applyShadowingOutcome({ box: 0, rating: 'hard', sessionIndex: 2 }).box).toBe(0);
	});

	it('drops an existing chunk by two boxes on very_hard, floored at 0', () => {
		expect(applyShadowingOutcome({ box: 3, rating: 'very_hard', sessionIndex: 2 }).box).toBe(1);
		expect(applyShadowingOutcome({ box: 1, rating: 'very_hard', sessionIndex: 2 }).box).toBe(0);
	});

	it('grows the box4 streak only on an unaided (easy) pass that stays at box 4', () => {
		const streak1 = applyShadowingOutcome({
			box: 4,
			box4Streak: 0,
			rating: 'easy',
			sessionIndex: 5
		});
		expect(streak1.box4Streak).toBe(1);
		const streak2 = applyShadowingOutcome({
			box: 4,
			box4Streak: 1,
			rating: 'easy',
			sessionIndex: 6
		});
		expect(streak2.box4Streak).toBe(2);
	});

	it('resets the box4 streak on a good pass at box 4, even though the box holds', () => {
		const result = applyShadowingOutcome({
			box: 4,
			box4Streak: 3,
			rating: 'good',
			sessionIndex: 6
		});
		expect(result.box).toBe(4);
		expect(result.box4Streak).toBe(0);
	});

	it('resets the box4 streak once a chunk drops out of box 4', () => {
		const result = applyShadowingOutcome({
			box: 4,
			box4Streak: 5,
			rating: 'hard',
			sessionIndex: 6
		});
		expect(result.box).toBe(3);
		expect(result.box4Streak).toBe(0);
	});

	it('records lastSession as the session index passed in', () => {
		expect(applyShadowingOutcome({ box: 1, rating: 'easy', sessionIndex: 42 }).lastSession).toBe(
			42
		);
	});
});
