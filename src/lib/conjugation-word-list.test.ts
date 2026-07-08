import { describe, expect, it } from 'vitest';
import { CONJUGATION_WORDS } from './conjugation-word-list';

function classOf(word: string): string | undefined {
	return CONJUGATION_WORDS.find((w) => w.word === word)?.wordClass;
}

describe('conjugation word classification: known regression cases', () => {
	it.each([
		['食べる', 'ichidan'],
		['見る', 'ichidan'],
		['話す', 'godan_su'],
		['行く', 'godan_ku'],
		['帰る', 'godan_ru'], // classic godan-る-despite-る-ending trap
		['入る', 'godan_ru'], // same trap
		['ある', 'godan_ru'], // irregular negative, still godan_ru elsewhere
		['なる', 'godan_ru'],
		['する', 'suru'],
		['来る', 'kuru'],
		['良い', 'i_adjective'],
		['大きい', 'i_adjective']
	])('%s classifies as %s', (word, expected) => {
		expect(classOf(word)).toBe(expected);
	});

	it('excludes known problem entries from the frozen source list', () => {
		for (const word of [
			'まえる',
			'ばる',
			'隠る',
			'恐る',
			'やって来る', // duplicate of やってくる
			'ゆく', // duplicate of 行く
			'訊く', // duplicate of 聞く
			'気がつく', // duplicate of 気づく
			'ほしい', // duplicate of 欲しい
			'ちまう' // colloquial contraction of 〜てしまう, not a dictionary lemma
		]) {
			expect(classOf(word)).toBeUndefined();
		}
	});

	it('excludes bare-kanji fragments and non-adjective entries misclassified as i_adjective', () => {
		for (const word of ['白', '薄', 'ごとし', '真っ赤']) {
			expect(classOf(word)).not.toBe('i_adjective');
		}
	});

	it('every verb-class and i_adjective entry ends in the kana its class implies', () => {
		const endingForClass: Record<string, string | null> = {
			godan_u: 'う',
			godan_ku: 'く',
			godan_gu: 'ぐ',
			godan_su: 'す',
			godan_tsu: 'つ',
			godan_nu: 'ぬ',
			godan_bu: 'ぶ',
			godan_mu: 'む',
			godan_ru: 'る',
			ichidan: 'る',
			suru: null,
			kuru: null,
			i_adjective: 'い',
			copula: null
		};
		for (const w of CONJUGATION_WORDS) {
			const expected = endingForClass[w.wordClass];
			if (expected === null || expected === undefined) continue;
			expect(w.word.endsWith(expected)).toBe(true);
		}
	});

	it('has no duplicate words', () => {
		const words = CONJUGATION_WORDS.map((w) => w.word);
		expect(new Set(words).size).toBe(words.length);
	});

	it('gives every entry a non-empty reading and meaning', () => {
		for (const w of CONJUGATION_WORDS) {
			expect(w.reading).not.toBe('');
			expect(w.meaning).not.toBe('');
		}
	});

	it('spot-checks readings/meanings for well-known words', () => {
		const byWord = new Map(CONJUGATION_WORDS.map((w) => [w.word, w]));
		expect(byWord.get('食べる')).toMatchObject({ reading: 'たべる', meaning: 'to eat' });
		expect(byWord.get('話す')).toMatchObject({ reading: 'はなす' });
		expect(byWord.get('大きい')).toMatchObject({ reading: 'おおきい' });
		expect(byWord.get('する')).toMatchObject({ reading: 'する', meaning: 'to do' });
	});
});
