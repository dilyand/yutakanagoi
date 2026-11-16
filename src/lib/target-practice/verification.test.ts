import { describe, expect, it } from 'vitest';
import {
	applyReviews,
	checkReviewResults,
	checkVerifyResults,
	contrastItemsToVerify,
	rejectedIndices
} from './verification';
import { grammarKakadouka, wordKibishii } from './fixtures';

describe('contrastItemsToVerify', () => {
	it('is the Grammar Contrast mc items and nothing else', () => {
		const ids = contrastItemsToVerify(grammarKakadouka.items).map((i) => i.id);
		expect(ids).toEqual(['g-c1', 'g-c2', 'g-c3']);
		expect(contrastItemsToVerify(wordKibishii.items)).toEqual([]);
	});
});

describe('checkVerifyResults', () => {
	const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

	it('returns the items the model doubted, with the problem', () => {
		expect(
			checkVerifyResults(
				{
					results: [
						{ id: 'a', ok: true, problem: '' },
						{ id: 'b', ok: false, problem: ' The marked sentence is grammatical. ' }
					]
				},
				items
			)
		).toEqual([{ id: 'b', problem: 'The marked sentence is grammatical.' }]);
	});

	it('keeps items with no result, malformed results, and ids it never asked about', () => {
		expect(
			checkVerifyResults(
				{ results: [{ id: 'zzz', ok: false }, { id: 'a' }, 'x', { id: 'b', ok: 'no' }] },
				items
			)
		).toEqual([]);
		expect(checkVerifyResults(undefined, items)).toEqual([]);
		expect(checkVerifyResults({ results: 'nope' }, items)).toEqual([]);
	});
});

describe('checkReviewResults', () => {
	it('returns one entry per rejected item, null when unusable', () => {
		expect(
			checkReviewResults(
				{
					results: [
						{ acceptable: true, feedback: ' Works. ' },
						{ acceptable: 'yes', feedback: 'x' }
					]
				},
				3
			)
		).toEqual([{ acceptable: true, feedback: 'Works.' }, null, null]);
		expect(checkReviewResults({ results: [{ acceptable: true, feedback: '  ' }] }, 1)).toEqual([
			null
		]);
	});
});

describe('applyReviews', () => {
	const verdicts = [
		{ correct: true, feedback: 'ok' },
		{ correct: false, feedback: 'first reason A' },
		null,
		{ correct: false, feedback: 'first reason B' }
	];

	it('overturns a rejection the reviewer finds acceptable', () => {
		const { verdicts: out, overturned } = applyReviews(
			verdicts,
			[1, 3],
			[
				{ acceptable: true, feedback: 'A native would accept this.' },
				{ acceptable: false, feedback: 'Better explanation of B.' }
			]
		);
		expect(out[1]).toEqual({ correct: true, feedback: 'A native would accept this.' });
		expect(overturned).toEqual([1]);
	});

	it('keeps the rejection but takes the reviewer’s feedback when it stands', () => {
		const { verdicts: out, overturned } = applyReviews(
			verdicts,
			[3],
			[{ acceptable: false, feedback: 'Better explanation of B.' }]
		);
		expect(out[3]).toEqual({ correct: false, feedback: 'Better explanation of B.' });
		expect(overturned).toEqual([]);
	});

	it('leaves the first verdict when the review is unusable, and never touches accepted ones', () => {
		const { verdicts: out } = applyReviews(
			verdicts,
			[1, 0],
			[null, { acceptable: false, feedback: 'x' }]
		);
		expect(out).toEqual(verdicts);
	});
});

describe('rejectedIndices', () => {
	it('lists only the rejections', () => {
		expect(
			rejectedIndices([{ correct: true, feedback: 'a' }, { correct: false, feedback: 'b' }, null])
		).toEqual([1]);
	});
});
