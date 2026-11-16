import { describe, expect, it } from 'vitest';
import { PHASE_KINDS, skeletonFor, totalItems } from './skeleton';
import { PHASE_IDS } from './types';
import { allFixtures } from './fixtures';

describe('skeletonFor', () => {
	it('totals match the design doc for every type', () => {
		const totals = Object.fromEntries(
			allFixtures.map((f) => [f.card.type, totalItems(skeletonFor(f.card))])
		);
		expect(totals).toEqual({ grammar: 16, contrast: 15, word: 15, kanji: 15, set_phrase: 15 });
	});

	it('drops the Sense phase for a single-sense word but keeps 15 items', () => {
		const word = allFixtures.find((f) => f.card.type === 'word')!.card;
		if (word.type !== 'word') throw new Error('unreachable');
		const single = { ...word, senses: [word.senses[0]] };
		const spec = skeletonFor(single);
		expect(spec.map((p) => p.id)).toEqual(['understand', 'produce', 'use']);
		expect(totalItems(spec)).toBe(15);
	});

	it('puts comprehension phases in stage 1 and production phases in stage 2', () => {
		for (const { card } of allFixtures) {
			for (const p of skeletonFor(card)) {
				const comprehension = ['understand', 'sense', 'reading', 'situation', 'sort'].includes(
					p.id
				);
				expect(p.stage).toBe(comprehension ? 1 : 2);
			}
		}
	});

	it('never asks for a minimum above the phase count', () => {
		for (const { card } of allFixtures) {
			for (const p of skeletonFor(card)) expect(p.min).toBeLessThanOrEqual(p.count);
		}
	});
});

describe('PHASE_KINDS', () => {
	it('covers every phase id', () => {
		expect(Object.keys(PHASE_KINDS).sort()).toEqual([...PHASE_IDS].sort());
	});
});
