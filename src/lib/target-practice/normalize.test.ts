import { describe, expect, it } from 'vitest';
import {
	TARGET_MASK,
	countBlanks,
	fillBlank,
	hasJapaneseScript,
	isKana,
	normalizeAnswer,
	toHiragana
} from './normalize';

describe('normalizeAnswer', () => {
	it('strips whitespace and punctuation, including fullwidth forms', () => {
		expect(normalizeAnswer('先に 失礼します。')).toBe('先に失礼します');
		expect(normalizeAnswer('お疲れ様です！')).toBe('お疲れ様です');
		expect(normalizeAnswer('Ｔｏ　ｒｕｎ,')).toBe('torun');
	});

	it('treats a halfwidth katakana answer like its fullwidth form (NFKC)', () => {
		expect(normalizeAnswer('ｶｲ')).toBe(normalizeAnswer('カイ'));
	});

	it('keeps the long-vowel mark and the target mask', () => {
		expect(normalizeAnswer('ラーメン')).toBe('ラーメン');
		expect(normalizeAnswer(`あ${TARGET_MASK}い`)).toBe(`あ${TARGET_MASK}い`);
	});

	it('does not fold hiragana, katakana or kanji into each other', () => {
		expect(normalizeAnswer('きた')).not.toBe(normalizeAnswer('来た'));
		expect(normalizeAnswer('かい')).not.toBe(normalizeAnswer('カイ'));
	});

	it('drops the wave dash used in grammar patterns', () => {
		expect(normalizeAnswer('〜かどうか')).toBe('かどうか');
		expect(normalizeAnswer('～かどうか')).toBe('かどうか');
	});
});

describe('blanks', () => {
	it('counts runs of fullwidth underscores as single blanks', () => {
		expect(countBlanks('雨が降る＿＿分からない')).toBe(1);
		expect(countBlanks('A＿B＿＿C')).toBe(2);
		expect(countBlanks('no blank')).toBe(0);
	});

	it('fills a blank literally (no $-pattern surprises)', () => {
		expect(fillBlank('雨が降る＿＿分からない', 'かどうか')).toBe('雨が降るかどうか分からない');
		expect(fillBlank('x＿y', '$&')).toBe('x$&y');
	});
});

describe('script helpers', () => {
	it('detects Japanese script', () => {
		expect(hasJapaneseScript('hello')).toBe(false);
		expect(hasJapaneseScript('hello かな')).toBe(true);
		expect(hasJapaneseScript('解')).toBe(true);
	});

	it('toHiragana converts katakana and keeps ー', () => {
		expect(toHiragana('カイ')).toBe('かい');
		expect(toHiragana('ラーメン')).toBe('らーめん');
	});

	it('isKana rejects kanji, latin and empty strings', () => {
		expect(isKana('かい')).toBe(true);
		expect(isKana('ゲ')).toBe(true);
		expect(isKana('解')).toBe(false);
		expect(isKana('a')).toBe(false);
		expect(isKana('')).toBe(false);
		expect(isKana('〜かい')).toBe(false);
		expect(isKana('〜かい', { allowPatternMarks: true })).toBe(true);
	});
});
