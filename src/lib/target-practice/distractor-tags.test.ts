import { describe, expect, it } from 'vitest';
import { allowedTagNames, isRequiredTag, parseTag, tagProblem, TYPE_TAGS } from './distractor-tags';
import { TARGET_TYPES } from './types';

describe('parseTag', () => {
	it('splits name and param on the first colon only', () => {
		expect(parseTag('other_sense:3')).toEqual({ name: 'other_sense', param: '3' });
		expect(parseTag('misread_similar_pattern:ても〜なくても')).toEqual({
			name: 'misread_similar_pattern',
			param: 'ても〜なくても'
		});
		expect(parseTag('context')).toEqual({ name: 'context' });
		expect(parseTag('a:b:c')).toEqual({ name: 'a', param: 'b:c' });
	});
});

describe('tag tables', () => {
	it('every type has at least one required tag', () => {
		for (const t of TARGET_TYPES) expect(TYPE_TAGS[t].required.length).toBeGreaterThan(0);
	});

	it('generic tags are allowed everywhere', () => {
		for (const t of TARGET_TYPES) {
			for (const g of ['context', 'opposite', 'unrelated']) {
				expect(allowedTagNames(t)).toContain(g);
			}
		}
	});

	it("rejects another type's required tag", () => {
		expect(tagProblem('word', 'wrong_side')).toMatch(/not allowed for word/);
		expect(tagProblem('contrast', 'other_sense:1')).toMatch(/not allowed for contrast/);
	});

	it('requires a param on other_sense but not on others', () => {
		expect(tagProblem('word', 'other_sense')).toMatch(/needs a parameter/);
		expect(tagProblem('word', 'other_sense:')).toMatch(/needs a parameter/);
		expect(tagProblem('word', 'other_sense:2')).toBeNull();
		expect(tagProblem('kanji', 'other_compound')).toBeNull();
		expect(tagProblem('kanji', 'other_compound:解説')).toBeNull();
	});

	it('knows which tags satisfy the Understand requirement', () => {
		expect(isRequiredTag('kanji', 'other_reading')).toBe(true);
		expect(isRequiredTag('kanji', 'lookalike')).toBe(false);
		expect(isRequiredTag('grammar', 'context')).toBe(false);
	});
});
