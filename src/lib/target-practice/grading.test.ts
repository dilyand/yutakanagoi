import { describe, expect, it } from 'vitest';
import { answerText, correctOption, gradeMc, gradeTiles, gradeTyped, typedNext } from './grading';
import { grammarKakadouka } from './fixtures';
import type { McItem, TilesItem, TypedItem } from './types';

const items = grammarKakadouka.items;
const mcItem = items.find((i): i is McItem => i.kind === 'mc')!;
const tilesItem = items.find((i): i is TilesItem => i.kind === 'tiles')!;
const cloze = items.find((i): i is TypedItem => i.kind === 'typed' && i.form === 'cloze')!;

describe('gradeMc', () => {
	it('is correct only for the correct option', () => {
		const right = mcItem.options.findIndex((o) => o.correct);
		expect(gradeMc(mcItem, right)).toBe(true);
		expect(gradeMc(mcItem, (right + 1) % mcItem.options.length)).toBe(false);
		expect(gradeMc(mcItem, 99)).toBe(false);
		expect(correctOption(mcItem)).toBe(mcItem.options[right].text);
	});
});

describe('gradeTiles', () => {
	it('accepts any accepted order, ignoring punctuation', () => {
		for (const a of tilesItem.accepted) {
			expect(gradeTiles(tilesItem, [a])).toBe(true);
			expect(gradeTiles(tilesItem, [a.replace(/[。、]/g, '')])).toBe(true);
		}
		expect(gradeTiles(tilesItem, [...tilesItem.tiles])).toBe(
			tilesItem.accepted.some((a) => a.replace(/[。、]/g, '') === tilesItem.tiles.join(''))
		);
		expect(gradeTiles(tilesItem, [])).toBe(false);
	});
});

describe('gradeTyped', () => {
	it('accepts the answer and each accepted variant, ignoring spaces and punctuation', () => {
		for (const a of cloze.accepted) expect(gradeTyped(cloze, ` ${a}。 `)).toBe(true);
	});

	it('also accepts the whole sentence with the blank filled in', () => {
		const full = cloze.sentence!.replace(/＿+/, cloze.answer);
		expect(gradeTyped(cloze, full)).toBe(true);
	});

	it('rejects a wrong or empty answer', () => {
		expect(gradeTyped(cloze, 'まったくちがう')).toBe(false);
		expect(gradeTyped(cloze, '   ')).toBe(false);
	});
});

describe('typedNext', () => {
	it('hints after the first miss and reveals after the second', () => {
		expect(typedNext(1)).toBe('hint');
		expect(typedNext(2)).toBe('reveal');
	});
});

describe('answerText', () => {
	it('gives the key for each kind', () => {
		expect(answerText(mcItem)).toBe(correctOption(mcItem));
		expect(answerText(cloze)).toBe(cloze.answer);
		expect(answerText(tilesItem)).toBe(tilesItem.accepted[0]);
		const use = items.find((i) => i.kind === 'claude')!;
		expect(answerText(use)).toBe(use.kind === 'claude' ? (use.expected[0] ?? '') : '');
	});
});
