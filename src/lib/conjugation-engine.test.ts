import { describe, expect, it } from 'vitest';
import {
	applyConjugationOutcome,
	buildConjugationRegistry,
	conjugate,
	conjugateCopula,
	conjugateIAdjective,
	pickWordForCell
} from './conjugation-engine';
import { MIN_NEW_SLOTS_PER_SESSION, selectDrillWords, type WordState } from './drill-algorithm';
import type { CopulaFormId, IAdjectiveFormId } from './conjugation-forms';
import type { ConjugationWord, VerbClass } from './conjugation-word-list';

/**
 * Drives `selectDrillWords` + `applyConjugationOutcome` over synthetic
 * sessions for a user who always answers correctly, exactly the way
 * `/api/conjugation/session/start` does — pure in-memory, no Supabase, no
 * Claude call. Returns how many distinct cells were ever introduced
 * (isNew: true at least once) within `maxSessions`.
 */
function simulateIntroducedCellCount(
	registry: { id: string }[],
	minNewSlots: number,
	maxSessions: number
): number {
	const registryAsVocab = registry.map((cell, index) => ({ word: cell.id, frequencyRank: index }));
	const cellStates = new Map<string, WordState>();
	const introduced = new Set<string>();

	for (let sessionIndex = 1; sessionIndex <= maxSessions; sessionIndex++) {
		const drillItems = selectDrillWords(
			registryAsVocab,
			[...cellStates.values()],
			sessionIndex,
			10,
			minNewSlots
		);
		for (const item of drillItems) {
			introduced.add(item.word);
			const priorBox = item.isNew ? undefined : item.box;
			const priorBox4Streak = item.isNew ? undefined : item.box4Streak;
			const result = applyConjugationOutcome({
				box: priorBox,
				box4Streak: priorBox4Streak,
				correct: true,
				sessionIndex
			});
			cellStates.set(item.word, {
				word: item.word,
				box: result.box,
				lastSession: result.lastSession,
				box4Streak: result.box4Streak
			});
		}
		if (introduced.size === registry.length) break;
	}

	return introduced.size;
}

describe('conjugateVerb: one representative word per class, core forms', () => {
	it.each([
		['言う', 'godan_u', 'nai', '言わない'],
		['言う', 'godan_u', 'ta', '言った'],
		['言う', 'godan_u', 'te', '言って'],
		['言う', 'godan_u', 'potential', '言える'],
		['言う', 'godan_u', 'causative', '言わせる'],
		['言う', 'godan_u', 'masu', '言います'],

		['聞く', 'godan_ku', 'nai', '聞かない'],
		['聞く', 'godan_ku', 'ta', '聞いた'],
		['聞く', 'godan_ku', 'te', '聞いて'],
		['聞く', 'godan_ku', 'potential', '聞ける'],

		['急ぐ', 'godan_gu', 'ta', '急いだ'],
		['急ぐ', 'godan_gu', 'te', '急いで'],

		['話す', 'godan_su', 'ta', '話した'],
		['話す', 'godan_su', 'te', '話して'],
		['話す', 'godan_su', 'potential', '話せる'],

		['持つ', 'godan_tsu', 'ta', '持った'],
		['持つ', 'godan_tsu', 'te', '持って'],

		['死ぬ', 'godan_nu', 'ta', '死んだ'],
		['死ぬ', 'godan_nu', 'te', '死んで'],

		['呼ぶ', 'godan_bu', 'ta', '呼んだ'],
		['呼ぶ', 'godan_bu', 'te', '呼んで'],

		['飲む', 'godan_mu', 'ta', '飲んだ'],
		['飲む', 'godan_mu', 'te', '飲んで'],

		// 帰る: the classic godan-る-despite-る-ending trap — must NOT conjugate
		// as ichidan (帰ない would be wrong).
		['帰る', 'godan_ru', 'nai', '帰らない'],
		['帰る', 'godan_ru', 'ta', '帰った'],
		['帰る', 'godan_ru', 'te', '帰って'],
		['帰る', 'godan_ru', 'masu', '帰ります'],
		['帰る', 'godan_ru', 'conditional_ba', '帰れば'],
		['帰る', 'godan_ru', 'conditional_tara', '帰ったら'],
		['帰る', 'godan_ru', 'imperative', '帰れ'],
		['帰る', 'godan_ru', 'volitional', '帰ろう'],
		['帰る', 'godan_ru', 'tai', '帰りたい'],

		['食べる', 'ichidan', 'nai', '食べない'],
		['食べる', 'ichidan', 'ta', '食べた'],
		['食べる', 'ichidan', 'te', '食べて'],
		['食べる', 'ichidan', 'volitional', '食べよう'],
		['食べる', 'ichidan', 'masu', '食べます'],

		['する', 'suru', 'nai', 'しない'],
		['する', 'suru', 'ta', 'した'],
		['する', 'suru', 'te', 'して'],
		['する', 'suru', 'potential', 'できる'],
		['する', 'suru', 'passive', 'される'],
		['する', 'suru', 'volitional', 'しよう'],
		['する', 'suru', 'masu', 'します'],

		['来る', 'kuru', 'nai', '来ない'],
		['来る', 'kuru', 'ta', '来た'],
		['来る', 'kuru', 'te', '来て'],
		['来る', 'kuru', 'imperative', '来い'],
		['来る', 'kuru', 'masu', '来ます'],

		['やってくる', 'kuru', 'nai', 'やってこない'],
		['やってくる', 'kuru', 'ta', 'やってきた'],
		['やって来る', 'kuru', 'nai', 'やって来ない'],
		['やって来る', 'kuru', 'ta', 'やって来た']
	])('%s (%s) %s -> %s', (word, wordClass, formId, expected) => {
		expect(conjugate(word, wordClass as VerbClass, formId)).toBe(expected);
	});
});

describe('conjugateVerb: known exceptions', () => {
	it('行く has an irregular た/て-form (行った/行って, not 行いた/行いて)', () => {
		expect(conjugate('行く', 'godan_ku', 'ta')).toBe('行った');
		expect(conjugate('行く', 'godan_ku', 'te')).toBe('行って');
		// Everything else about 行く is regular.
		expect(conjugate('行く', 'godan_ku', 'nai')).toBe('行かない');
	});

	it('ある has no regular negative form (irregular suppletion to ない)', () => {
		expect(() => conjugate('ある', 'godan_ru', 'nai')).toThrow();
		expect(() => conjugate('ある', 'godan_ru', 'nakatta')).toThrow();
		expect(() => conjugate('ある', 'godan_ru', 'nakute')).toThrow();
		// Every other form of ある is regular godan_ru.
		expect(conjugate('ある', 'godan_ru', 'ta')).toBe('あった');
		expect(conjugate('ある', 'godan_ru', 'te')).toBe('あって');
		expect(conjugate('ある', 'godan_ru', 'masu')).toBe('あります');
	});

	it('ichidan potential and passive are deliberately identical', () => {
		expect(conjugate('食べる', 'ichidan', 'potential')).toBe('食べられる');
		expect(conjugate('食べる', 'ichidan', 'passive')).toBe(
			conjugate('食べる', 'ichidan', 'potential')
		);
	});
});

describe('conjugateVerb: two-stem compounds', () => {
	it.each([
		['食べる', 'ichidan', 'potential_negative', '食べられない'],
		['食べる', 'ichidan', 'potential_past', '食べられた'],
		['食べる', 'ichidan', 'passive_negative', '食べられない'],
		['食べる', 'ichidan', 'passive_past', '食べられた'],
		['食べる', 'ichidan', 'causative_negative', '食べさせない'],
		['食べる', 'ichidan', 'causative_past', '食べさせた'],
		['食べる', 'ichidan', 'causative_passive', '食べさせられる'],
		['食べる', 'ichidan', 'causative_passive_past', '食べさせられた'],

		['帰る', 'godan_ru', 'potential_negative', '帰れない'],
		['帰る', 'godan_ru', 'passive_negative', '帰られない'],
		['帰る', 'godan_ru', 'causative_negative', '帰らせない'],
		['帰る', 'godan_ru', 'causative_passive', '帰らせられる'],
		['帰る', 'godan_ru', 'causative_passive_past', '帰らせられた']
	])('%s (%s) %s -> %s', (word, wordClass, formId, expected) => {
		expect(conjugate(word, wordClass as VerbClass, formId)).toBe(expected);
	});
});

describe('conjugateIAdjective: full form enumeration for one representative word', () => {
	it.each([
		['negative', '大きくない'],
		['past', '大きかった'],
		['past_negative', '大きくなかった'],
		['te', '大きくて'],
		['negative_te', '大きくなくて'],
		['conditional_kereba', '大きければ'],
		['adverbial', '大きく'],
		['sou', '大きそう'],
		['polite', '大きいです'],
		['polite_past', '大きかったです']
	])('大きい %s -> %s', (formId, expected) => {
		expect(conjugateIAdjective('大きい', formId as IAdjectiveFormId)).toBe(expected);
	});
});

describe('conjugateIAdjective: known exceptions', () => {
	it('adjectives ending in ない take さそう, not そう, for -sou', () => {
		expect(conjugateIAdjective('少ない', 'sou' as IAdjectiveFormId)).toBe('少なさそう');
		// Otherwise 少ない is regular.
		expect(conjugateIAdjective('少ない', 'negative' as IAdjectiveFormId)).toBe('少なくない');
	});

	it('いい conjugates from よい for every form except the plain dictionary form', () => {
		expect(conjugateIAdjective('いい', 'negative' as IAdjectiveFormId)).toBe('よくない');
		expect(conjugateIAdjective('いい', 'past' as IAdjectiveFormId)).toBe('よかった');
		expect(conjugateIAdjective('いい', 'sou' as IAdjectiveFormId)).toBe('よさそう');
		// Polite form keeps いい as commonly taught/accepted, since it isn't
		// stem-derived.
		expect(conjugateIAdjective('いい', 'polite' as IAdjectiveFormId)).toBe('いいです');
	});
});

describe('conjugateCopula: full form enumeration for one representative word', () => {
	it.each([
		['negative', '静かじゃない'],
		['past', '静かだった'],
		['past_negative', '静かじゃなかった'],
		['te', '静かで'],
		['conditional_nara', '静かなら'],
		['desu', '静かです'],
		['negative_desu', '静かじゃないです'],
		['deshita', '静かでした'],
		['past_negative_desu', '静かじゃなかったです']
	])('静か %s -> %s', (formId, expected) => {
		expect(conjugateCopula('静か', formId as CopulaFormId)).toBe(expected);
	});
});

describe('buildConjugationRegistry', () => {
	it('generates one cell per (word class, form) pair with no duplicate ids', () => {
		const cells = buildConjugationRegistry();
		// 25 forms x 12 verb classes + 10 i_adjective + 9 copula
		expect(cells).toHaveLength(25 * 12 + 10 + 9);
		expect(new Set(cells.map((c) => c.id)).size).toBe(cells.length);
	});

	it('the exact first 10 cells match the expected diagonal traversal order', () => {
		const cells = buildConjugationRegistry().slice(0, 10);
		expect(cells.map((c) => c.id)).toEqual([
			'godan_u:nai',
			'godan_u:ta',
			'godan_ku:nai',
			'godan_u:nakatta',
			'godan_ku:ta',
			'godan_gu:nai',
			'godan_u:te',
			'godan_ku:nakatta',
			'godan_gu:ta',
			'godan_su:nai'
		]);
	});

	it('spreads variety across both forms and classes within a short prefix, unlike a single-axis-major order', () => {
		const cells = buildConjugationRegistry();
		// A form-major order (the previous fix, which caused this regression)
		// would show exactly 1 distinct form here; a class-major order (the
		// fix before that) would show exactly 1 distinct class. Diagonal
		// traversal grows both together instead.
		const first10Forms = new Set(cells.slice(0, 10).map((c) => c.formId));
		const first10Classes = new Set(cells.slice(0, 10).map((c) => c.wordClass));
		expect(first10Forms.size).toBeGreaterThanOrEqual(4);
		expect(first10Classes.size).toBeGreaterThanOrEqual(4);

		const first50Classes = new Set(cells.slice(0, 50).map((c) => c.wordClass));
		const first50Forms = new Set(cells.slice(0, 50).map((c) => c.formId));
		expect(first50Classes.size).toBeGreaterThanOrEqual(8);
		expect(first50Forms.size).toBeGreaterThanOrEqual(9);
	});
});

describe('pickWordForCell', () => {
	const words: ConjugationWord[] = [
		{
			word: 'ある',
			frequencyRank: 4,
			wordClass: 'godan_ru',
			reading: 'ある',
			meaning: 'to exist'
		},
		{
			word: '帰る',
			frequencyRank: 104,
			wordClass: 'godan_ru',
			reading: 'かえる',
			meaning: 'to return'
		},
		{
			word: '食べる',
			frequencyRank: 386,
			wordClass: 'ichidan',
			reading: 'たべる',
			meaning: 'to eat'
		}
	];

	it('never picks ある for its irregular-negative cells', () => {
		for (let i = 0; i < 20; i++) {
			const picked = pickWordForCell('godan_ru', 'nai', words);
			expect(picked.word).toBe('帰る');
		}
	});

	it('can still pick ある for a regular form', () => {
		const picks = new Set<string>();
		for (let i = 0; i < 50; i++) {
			picks.add(pickWordForCell('godan_ru', 'ta', words).word);
		}
		expect(picks.has('ある')).toBe(true);
		expect(picks.has('帰る')).toBe(true);
	});

	it('throws when no candidate exists for the requested class', () => {
		expect(() => pickWordForCell('suru', 'nai', words)).toThrow();
	});
});

describe('applyConjugationOutcome', () => {
	it('starts a new cell at box 1 on a correct answer, NOT box 4 like vocab drill', () => {
		expect(applyConjugationOutcome({ box: undefined, correct: true, sessionIndex: 1 })).toEqual({
			box: 1,
			lastSession: 1,
			box4Streak: 0
		});
	});

	it('starts a new cell at box 0 on an incorrect answer', () => {
		expect(applyConjugationOutcome({ box: undefined, correct: false, sessionIndex: 1 })).toEqual({
			box: 0,
			lastSession: 1,
			box4Streak: 0
		});
	});

	it('increments an existing cell by one on a correct answer, capped at 4', () => {
		expect(applyConjugationOutcome({ box: 2, correct: true, sessionIndex: 3 })).toEqual({
			box: 3,
			lastSession: 3,
			box4Streak: 0
		});
		expect(
			applyConjugationOutcome({ box: 4, box4Streak: 0, correct: true, sessionIndex: 3 })
		).toEqual({
			box: 4,
			lastSession: 3,
			box4Streak: 1
		});
	});

	it('decrements an existing cell by one on an incorrect answer, floored at 0', () => {
		expect(applyConjugationOutcome({ box: 2, correct: false, sessionIndex: 3 })).toEqual({
			box: 1,
			lastSession: 3,
			box4Streak: 0
		});
		expect(applyConjugationOutcome({ box: 0, correct: false, sessionIndex: 3 })).toEqual({
			box: 0,
			lastSession: 3,
			box4Streak: 0
		});
	});

	it('grows box4Streak on repeated correct answers at box 4, resetting if it ever drops out', () => {
		const grown = applyConjugationOutcome({
			box: 4,
			box4Streak: 3,
			correct: true,
			sessionIndex: 10
		});
		expect(grown.box4Streak).toBe(4);

		const dropped = applyConjugationOutcome({
			box: 4,
			box4Streak: 3,
			correct: false,
			sessionIndex: 10
		});
		expect(dropped).toEqual({ box: 3, lastSession: 10, box4Streak: 0 });
	});
});

describe('conjugation registry reachability (2.2.1 fix)', () => {
	it('introduces every cell within a bounded number of sessions when minNewSlots reserves new-cell room', () => {
		const registry = buildConjugationRegistry();
		expect(registry.length).toBe(319);

		const introduced = simulateIntroducedCellCount(registry, MIN_NEW_SLOTS_PER_SESSION, 150);

		expect(introduced).toBe(registry.length);
	});

	it('without minNewSlots, a best-case user stalls well short of the full registry within a realistic session count', () => {
		const registry = buildConjugationRegistry();

		const introduced = simulateIntroducedCellCount(registry, 0, 300);

		expect(introduced).toBeLessThan(registry.length);
	});
});
