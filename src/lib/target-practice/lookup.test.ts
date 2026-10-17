import { describe, expect, it } from 'vitest';
import {
	MAX_CANDIDATES,
	checkCardResult,
	confirmTarget,
	targetKey,
	validateCandidates
} from './lookup';
import type { ConfirmedTarget, ModelCardResult } from './lookup';
import {
	contrastKimeruKimaru,
	grammarKakadouka,
	kanjiKai,
	setPhraseOtsukaresama,
	wordKibishii
} from './fixtures';
import type { Card } from './types';

const c = (target: string, reading: string, gloss: string) => ({ target, reading, gloss });

describe('validateCandidates', () => {
	it('keeps valid candidates in order, trimming and normalising', () => {
		const { valid, dropped } = validateCandidates('grammar', [
			c('～かどうか', 'かどうか', ' whether or not '),
			c('〜ても〜なくても', 'ても〜なくても', 'regardless of whether')
		]);
		expect(dropped).toEqual([]);
		expect(valid).toEqual([
			c('〜かどうか', 'かどうか', 'whether or not'),
			c('〜ても〜なくても', 'ても〜なくても', 'regardless of whether')
		]);
	});

	it('accepts patterns with optional-part parentheses', () => {
		expect(
			validateCandidates('grammar', [c('〜(よ)うとする', '〜ようとする', 'try to')]).valid
		).toHaveLength(1);
	});

	it('keeps homographs that differ only by reading, and drops exact duplicates', () => {
		const { valid, dropped } = validateCandidates('word', [
			c('人気', 'にんき', 'popularity'),
			c('人気', 'ひとけ', 'signs of people'),
			c('人気', 'ニンキ', 'popularity again')
		]);
		expect(valid.map((v) => v.reading)).toEqual(['にんき', 'ひとけ']);
		expect(dropped).toEqual([{ index: 2, reason: 'duplicate candidate' }]);
	});

	it('drops targets that are not valid Japanese input for the type', () => {
		const { valid, dropped } = validateCandidates('word', [
			c('run', 'ran', 'to run'), // English target
			c('走る 速い', 'はしる', 'two words'),
			c('走る', 'はしる', 'to run')
		]);
		expect(valid.map((v) => v.target)).toEqual(['走る']);
		expect(dropped).toHaveLength(2);
	});

	it('drops non-kana readings, non-English glosses and malformed entries', () => {
		const { valid, dropped } = validateCandidates('word', [
			c('走る', 'hashiru', 'to run'),
			c('走る', 'はしる', '走る'),
			c('走る', 'はしる', 'x'.repeat(101)),
			{ target: '走る', reading: 'はしる' },
			null,
			c('走る', 'はしる', 'to run')
		]);
		expect(valid).toEqual([c('走る', 'はしる', 'to run')]);
		expect(dropped.map((d) => d.index)).toEqual([0, 1, 2, 3, 4]);
	});

	it(`caps the list at ${MAX_CANDIDATES}`, () => {
		const many = ['生', '生き', '生む', '生える', '生かす'].map((t, i) =>
			c(t, `かな${'あ'.repeat(i + 1)}`, 'x')
		);
		expect(validateCandidates('word', many).valid).toHaveLength(MAX_CANDIDATES);
	});
});

describe('confirmTarget', () => {
	it('accepts a cleaned Japanese target with a candidate reading and gloss', () => {
		expect(
			confirmTarget('word', { target: '人気', reading: ' ひとけ ', gloss: 'signs of people' })
		).toEqual({
			ok: true,
			confirmed: { type: 'word', target: '人気', reading: 'ひとけ', gloss: 'signs of people' }
		});
	});

	it('rejects English targets and invalid input for the type', () => {
		expect(confirmTarget('word', { target: 'deadline' }).ok).toBe(false);
		expect(confirmTarget('kanji', { target: '理解' }).ok).toBe(false);
		expect(confirmTarget('word', { target: '' }).ok).toBe(false);
	});

	it('carries a Contrast pair as typed', () => {
		expect(confirmTarget('contrast', { target: '決める / 決まる' })).toEqual({
			ok: true,
			confirmed: { type: 'contrast', target: '決める vs 決まる', sides: ['決める', '決まる'] }
		});
	});

	it('bounds the untrusted reading and gloss, and only allows them on Word/Grammar', () => {
		expect(confirmTarget('word', { target: '走る', reading: 'run' }).ok).toBe(false);
		expect(confirmTarget('word', { target: '走る', gloss: '走る' }).ok).toBe(false);
		expect(confirmTarget('word', { target: '走る', gloss: 'x'.repeat(101) }).ok).toBe(false);
		expect(
			confirmTarget('set_phrase', { target: 'お疲れ様です', reading: 'おつかれさまです' }).ok
		).toBe(false);
	});
});

// The fixtures are valid cards by construction. Strip what the server adds
// back (ok/type/target) and feed them through as if they were the model's
// output: the round trip must reproduce them exactly.
function asModelResult(card: Card): ModelCardResult {
	const { ok: _ok, type: _type, target: _target, ...body } = card; // eslint-disable-line @typescript-eslint/no-unused-vars
	return { ok: true, card: body };
}

function confirmedFor(card: Card): ConfirmedTarget {
	if (card.type === 'contrast') {
		const sides: [string, string] = [card.sides[0].form, card.sides[1].form];
		return { type: 'contrast', target: card.target, sides };
	}
	return { type: card.type, target: card.target };
}

describe('checkCardResult', () => {
	it.each([grammarKakadouka, contrastKimeruKimaru, wordKibishii, kanjiKai, setPhraseOtsukaresama])(
		'round-trips the $name fixture card',
		({ card }) => {
			expect(checkCardResult(asModelResult(card), confirmedFor(card))).toEqual({
				status: 'ok',
				card
			});
		}
	);

	it('takes the target from the confirmed pick, not the model', () => {
		const { card } = wordKibishii;
		const result = asModelResult(card) as { ok: true; card: Record<string, unknown> };
		result.card.target = '厳しい!!';
		const checked = checkCardResult(result, confirmedFor(card));
		expect(checked.status === 'ok' && checked.card.target).toBe(card.target);
	});

	it('turns an ok:false result into a rejection with the suggested type', () => {
		const rejected = checkCardResult(
			{ ok: false, reason: 'This is a set phrase.', suggestedType: 'set_phrase' },
			{ type: 'word', target: 'お疲れ様です' }
		);
		expect(rejected).toEqual({
			status: 'rejected',
			reason: 'This is a set phrase.',
			suggestedType: 'set_phrase'
		});
	});

	it('treats suggestedType "none" and the current type as no suggestion', () => {
		for (const suggestedType of ['none', 'word']) {
			const rejected = checkCardResult(
				{ ok: false, reason: 'No.', suggestedType },
				{ type: 'word', target: 'お疲れ様です' }
			);
			expect(rejected).toEqual({ status: 'rejected', reason: 'No.', suggestedType: undefined });
		}
	});

	it('rejects a similar_kanji Contrast as not supported', () => {
		const result = asModelResult(contrastKimeruKimaru.card) as {
			ok: true;
			card: Record<string, unknown>;
		};
		result.card.contrastKind = 'similar_kanji';
		const checked = checkCardResult(result, confirmedFor(contrastKimeruKimaru.card));
		expect(checked).toMatchObject({
			status: 'rejected',
			reason: expect.stringMatching(/not supported/)
		});
	});

	it('flags a card whose reading differs from the confirmed candidate', () => {
		const { card } = wordKibishii;
		const checked = checkCardResult(asModelResult(card), {
			...confirmedFor(card),
			reading: 'ひとけ'
		});
		expect(checked.status).toBe('invalid');
	});

	it('compares readings across hiragana/katakana and pattern marks', () => {
		const { card } = grammarKakadouka;
		const confirmed = { ...confirmedFor(card), reading: '〜カドウカ' };
		expect(checkCardResult(asModelResult(card), confirmed).status).toBe('ok');
	});

	it('flags a Contrast whose sides are swapped or replaced', () => {
		const { card } = contrastKimeruKimaru;
		const base = confirmedFor(card);
		const swapped = { ...base, sides: [base.sides![1], base.sides![0]] as [string, string] };
		expect(checkCardResult(asModelResult(card), swapped).status).toBe('invalid');
	});

	it('reports schema-level problems from validateCard as invalid', () => {
		const result = asModelResult(wordKibishii.card) as { ok: true; card: Record<string, unknown> };
		result.card.senses = [];
		expect(checkCardResult(result, confirmedFor(wordKibishii.card)).status).toBe('invalid');
	});
});

describe('targetKey', () => {
	it('is the target for every type but Word', () => {
		expect(targetKey(grammarKakadouka.card)).toBe('〜かどうか');
		expect(targetKey(kanjiKai.card)).toBe('解');
		expect(targetKey(setPhraseOtsukaresama.card)).toBe('お疲れ様です');
		expect(targetKey(contrastKimeruKimaru.card)).toBe('決める vs 決まる');
	});

	it('adds the reading for Word so homographs get separate rows', () => {
		expect(targetKey(wordKibishii.card)).toBe('厳しい|きびしい');
		const other = { ...wordKibishii.card, reading: 'ヒトケ' };
		expect(targetKey(other)).toBe('厳しい|ひとけ');
	});
});
