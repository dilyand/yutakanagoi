import { describe, expect, it } from 'vitest';
import {
	MAX_INPUT_LENGTH,
	cleanInput,
	parseContrastInput,
	validateTargetInput
} from './input-validation';

function ok(type: Parameters<typeof validateTargetInput>[0], raw: string) {
	const r = validateTargetInput(type, raw);
	if (!r.ok) throw new Error(`expected ok for ${type} "${raw}", got: ${r.message}`);
	return r;
}
function bad(type: Parameters<typeof validateTargetInput>[0], raw: string) {
	const r = validateTargetInput(type, raw);
	if (r.ok) throw new Error(`expected rejection for ${type} "${raw}"`);
	return r.message;
}

describe('cleanInput', () => {
	it('trims, collapses whitespace and unifies wave dashes', () => {
		expect(cleanInput('  ～てしまう ')).toBe('〜てしまう');
		expect(cleanInput('~ことになる')).toBe('〜ことになる');
		expect(cleanInput('to　run')).toBe('to run');
	});
});

describe('all types', () => {
	it('rejects empty input and input over the cap', () => {
		expect(bad('word', '   ')).toMatch(/Type something/);
		expect(bad('word', 'あ'.repeat(MAX_INPUT_LENGTH + 1))).toMatch(/40 characters/);
		expect(validateTargetInput('word', 'あ'.repeat(MAX_INPUT_LENGTH)).ok).toBe(true);
	});
});

describe('kanji', () => {
	it('accepts exactly one ideograph', () => {
		expect(ok('kanji', '解')).toMatchObject({
			value: '解',
			language: 'ja',
			needsCandidates: false
		});
		expect(ok('kanji', '憂').value).toBe('憂');
	});
	it('rejects compounds, kana, repeat marks and Latin', () => {
		expect(bad('kanji', '解決')).toMatch(/exactly one/);
		expect(bad('kanji', 'かい')).toMatch(/exactly one/);
		expect(bad('kanji', 'か')).toMatch(/one kanji/);
		expect(bad('kanji', '々')).toMatch(/one kanji/);
		expect(bad('kanji', 'a')).toMatch(/one kanji/);
	});
});

describe('word', () => {
	it('accepts Japanese words without candidates', () => {
		expect(ok('word', '食べる')).toMatchObject({ language: 'ja', needsCandidates: false });
		expect(ok('word', 'たべる').value).toBe('たべる');
		expect(ok('word', 'ラーメン').value).toBe('ラーメン');
	});
	it('routes English words through the candidate step', () => {
		expect(ok('word', 'deadline')).toMatchObject({ language: 'en', needsCandidates: true });
		expect(ok('word', 'to run')).toMatchObject({ language: 'en', needsCandidates: true });
	});
	it('rejects phrases, sentences, patterns and mixed scripts', () => {
		expect(bad('word', '食べる 飲む')).toMatch(/single word/);
		expect(bad('word', '食べます。')).toMatch(/no punctuation/);
		expect(bad('word', '〜てしまう')).toMatch(/Grammar/);
		expect(bad('word', 'the more the more')).toMatch(/single word/);
		expect(bad('word', 'run 走る')).toMatch(/not both/);
	});
});

describe('set_phrase', () => {
	it('accepts fixed expressions, including proverbs and idioms', () => {
		expect(ok('set_phrase', 'お疲れ様です').value).toBe('お疲れ様です');
		expect(ok('set_phrase', 'しょうがない').language).toBe('ja');
		expect(ok('set_phrase', '気が重い').needsCandidates).toBe(false);
		expect(ok('set_phrase', '猿も木から落ちる').value).toBe('猿も木から落ちる');
	});
	it('rejects slots, English, sentences and single characters', () => {
		expect(bad('set_phrase', '〜てしまう')).toMatch(/slot/);
		expect(bad('set_phrase', 'good work')).toMatch(/Japanese/);
		expect(bad('set_phrase', 'お疲れ様です。')).toMatch(/no full stop/);
		expect(bad('set_phrase', '疲')).toMatch(/more than one/);
	});
});

describe('grammar', () => {
	it('accepts Japanese patterns without candidates', () => {
		expect(ok('grammar', '〜てしまう')).toMatchObject({ language: 'ja', needsCandidates: false });
		expect(ok('grammar', '～わけではない').value).toBe('〜わけではない');
		expect(ok('grammar', '〜ことになる').value).toBe('〜ことになる');
	});
	it('accepts an English description and routes it through candidates', () => {
		expect(ok('grammar', 'whether or not')).toMatchObject({
			language: 'en',
			needsCandidates: true
		});
		expect(ok('grammar', 'the more, the more').value).toBe('the more, the more');
	});
	it('rejects full sentences, single English words and mixed scripts', () => {
		expect(bad('grammar', '雨が降っています。')).toMatch(/not a full sentence/);
		expect(bad('grammar', 'deadline')).toMatch(/few English words/);
		expect(bad('grammar', 'more 〜ても')).toMatch(/not both/);
	});
});

describe('contrast', () => {
	it('splits on vs, slash and the ideographic comma', () => {
		expect(ok('contrast', '決める vs 決まる').sides).toEqual(['決める', '決まる']);
		expect(ok('contrast', '知る/分かる').sides).toEqual(['知る', '分かる']);
		expect(ok('contrast', 'ので、から').sides).toEqual(['ので', 'から']);
		expect(ok('contrast', 'ので VS から').value).toBe('ので vs から');
	});
	it('splits on whitespace when there are exactly two tokens', () => {
		expect(ok('contrast', '決める 決まる').sides).toEqual(['決める', '決まる']);
	});
	it('does not treat と as a separator, so words containing と stay enterable', () => {
		expect(ok('contrast', 'ところ vs とき').sides).toEqual(['ところ', 'とき']);
		expect(ok('contrast', '止める/止まる').sides).toEqual(['止める', '止まる']);
		expect(ok('contrast', 'とる、とまる').sides).toEqual(['とる', 'とまる']);
		expect(bad('contrast', '決めると決まる')).toMatch(/Separate the two items/);
		expect(bad('contrast', 'ので と から')).toMatch(/exactly two/);
	});
	it('rejects three items, identical sides and empty sides', () => {
		expect(bad('contrast', 'a/b/c')).toBeTruthy();
		expect(bad('contrast', '決める/決める/決まる')).toMatch(/exactly two/);
		expect(bad('contrast', '決める vs 決める')).toMatch(/same/);
		expect(bad('contrast', '決める vs')).toBeTruthy();
	});
	it('rejects English on either side', () => {
		expect(bad('contrast', 'decide vs 決まる')).toMatch(/Japanese only/);
	});
});

describe('parseContrastInput', () => {
	it('treats kana variants of one word as identical only if they normalize equal', () => {
		expect(parseContrastInput('決める vs 決める。').ok).toBe(false);
		expect(parseContrastInput('決める vs きめる').ok).toBe(true);
	});
});
