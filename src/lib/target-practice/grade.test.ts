import { describe, expect, it } from 'vitest';
import { MAX_FEEDBACK_LENGTH, checkGradeResults, toGradeInput } from './grade';
import { grammarKakadouka } from './fixtures';

const items = grammarKakadouka.items;

describe('toGradeInput', () => {
	it('maps typed items to mode typed and claude items to mode use', () => {
		const typed = items.find((i) => i.kind === 'typed')!;
		const use = items.find((i) => i.kind === 'claude')!;
		expect(toGradeInput(typed, 'abc')).toMatchObject({ mode: 'typed', learnerAnswer: 'abc' });
		expect(toGradeInput(use, 'abc')).toMatchObject({ mode: 'use', learnerAnswer: 'abc' });
	});

	it('returns null for items graded locally', () => {
		expect(
			toGradeInput(
				items.find((i) => i.kind === 'mc')!,
				'x'
			)
		).toBeNull();
		expect(
			toGradeInput(
				items.find((i) => i.kind === 'tiles')!,
				'x'
			)
		).toBeNull();
	});
});

describe('checkGradeResults', () => {
	it('returns one verdict per input, in order', () => {
		const out = checkGradeResults(
			{
				results: [
					{ correct: true, feedback: ' Fine. ' },
					{ correct: false, feedback: 'No.' }
				]
			},
			2
		);
		expect(out).toEqual([
			{ correct: true, feedback: 'Fine.' },
			{ correct: false, feedback: 'No.' }
		]);
	});

	it('turns missing, short or malformed entries into null, never into correct', () => {
		expect(checkGradeResults({ results: [{ correct: 'yes', feedback: 'x' }] }, 2)).toEqual([
			null,
			null
		]);
		expect(checkGradeResults({ results: [{ correct: true, feedback: '  ' }] }, 1)).toEqual([null]);
		expect(checkGradeResults(undefined, 3)).toEqual([null, null, null]);
		expect(checkGradeResults({ results: 'nope' }, 1)).toEqual([null]);
	});

	it('truncates long feedback', () => {
		const [v] = checkGradeResults(
			{ results: [{ correct: true, feedback: 'a'.repeat(MAX_FEEDBACK_LENGTH + 50) }] },
			1
		);
		expect(v?.feedback).toHaveLength(MAX_FEEDBACK_LENGTH);
	});
});
