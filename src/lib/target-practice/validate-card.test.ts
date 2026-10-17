import { describe, expect, it } from 'vitest';
import { validateCard } from './validate-card';
import { allFixtures } from './fixtures';
import type { TargetType } from './types';

function clone<T>(v: T): T {
	return JSON.parse(JSON.stringify(v)) as T;
}
function fixtureCard(type: TargetType): Record<string, unknown> {
	return clone(allFixtures.find((f) => f.card.type === type)!.card) as unknown as Record<
		string,
		unknown
	>;
}
function problemsOf(raw: unknown, type: TargetType): string[] {
	const r = validateCard(raw, type);
	if (r.status !== 'invalid') throw new Error(`expected invalid, got ${r.status}`);
	return r.problems;
}

describe('validateCard — Appendix A cards', () => {
	it.each(allFixtures.map((f) => [f.card.type] as [TargetType]))(
		'accepts the %s fixture card',
		(type) => {
			expect(validateCard(fixtureCard(type), type).status).toBe('ok');
		}
	);
});

describe('validateCard — model refusals', () => {
	it('turns ok:false into a rejection with a suggested type', () => {
		const r = validateCard(
			{ ok: false, reason: 'This looks like a grammar pattern.', suggestedType: 'grammar' },
			'word'
		);
		expect(r).toEqual({
			status: 'rejected',
			reason: 'This looks like a grammar pattern.',
			suggestedType: 'grammar'
		});
	});

	it('ignores a suggested type that is the current type or unknown', () => {
		expect(validateCard({ ok: false, reason: 'x', suggestedType: 'word' }, 'word')).toMatchObject({
			status: 'rejected',
			suggestedType: undefined
		});
		expect(validateCard({ ok: false, reason: 'x', suggestedType: 'nope' }, 'word')).toMatchObject({
			suggestedType: undefined
		});
	});

	it('rejects similar_kanji contrasts as not supported yet', () => {
		const card = { ...fixtureCard('contrast'), contrastKind: 'similar_kanji' };
		expect(validateCard(card, 'contrast')).toMatchObject({
			status: 'rejected',
			reason: expect.stringMatching(/not supported yet/)
		});
	});
});

describe('validateCard — malformed cards', () => {
	it('rejects non-objects, a missing ok flag, and a type mismatch', () => {
		expect(problemsOf(null, 'word')).toEqual(['card is not an object']);
		expect(problemsOf({}, 'word')).toEqual(['card.ok must be true or false']);
		expect(problemsOf({ ...fixtureCard('word') }, 'kanji')[0]).toMatch(/expected kanji/);
	});

	it('caps a word at four senses', () => {
		const card = fixtureCard('word') as { senses: Array<Record<string, unknown>> };
		const extra = card.senses[0];
		card.senses.push({ ...extra, id: 4 }, { ...extra, id: 5 }, { ...extra, id: 6 });
		expect(problemsOf(card, 'word').join('|')).toMatch(/max 4/);
	});

	it('rejects duplicate sense ids', () => {
		const card = fixtureCard('word') as { senses: Array<Record<string, unknown>> };
		card.senses[1].id = 1;
		expect(problemsOf(card, 'word').join('|')).toMatch(/duplicate sense id 1/);
	});

	it('allows at most one rare kanji reading, and only kana readings', () => {
		const card = fixtureCard('kanji') as { readings: Array<Record<string, unknown>> };
		card.readings.forEach((r) => (r.rare = true));
		expect(problemsOf(card, 'kanji').join('|')).toMatch(/flagged rare/);

		const card2 = fixtureCard('kanji') as { readings: Array<Record<string, unknown>> };
		card2.readings[0].kana = 'と(く)';
		expect(problemsOf(card2, 'kanji').join('|')).toMatch(/kana-only/);
	});

	it('requires kanji compounds to contain the kanji', () => {
		const card = fixtureCard('kanji') as { compounds: Array<Record<string, unknown>> };
		card.compounds[0].word = '理由';
		expect(problemsOf(card, 'kanji').join('|')).toMatch(/does not contain the kanji/);
	});

	it('rejects an unknown contrastKind and identical sides', () => {
		const card = { ...fixtureCard('contrast'), contrastKind: 'vibes' };
		expect(problemsOf(card, 'contrast').join('|')).toMatch(/contrastKind must be one of/);

		const card2 = fixtureCard('contrast') as { sides: Array<Record<string, unknown>> };
		card2.sides[1].form = card2.sides[0].form;
		expect(problemsOf(card2, 'contrast').join('|')).toMatch(/same form/);
	});

	it('requires 2-3 Japanese model sentences for grammar', () => {
		const card = fixtureCard('grammar');
		card.modelSentences = ['only one 日本語です。'];
		expect(problemsOf(card, 'grammar').join('|')).toMatch(/modelSentences must have 2-3/);
		card.modelSentences = ['English only', 'also English'];
		expect(problemsOf(card, 'grammar').join('|')).toMatch(/must be Japanese/);
	});

	it('requires a kana reading on word, set_phrase and grammar cards', () => {
		const card = fixtureCard('set_phrase');
		card.reading = '御疲れ様です';
		expect(problemsOf(card, 'set_phrase').join('|')).toMatch(/reading must be kana only/);
	});
});
