import { describe, expect, it } from 'vitest';
import { buildCandidates, foldKey, glossFor, toDictionaryRow } from './dictionary';
import type { DictForm, DictSense, DictionaryEntry, JmdictWord } from './dictionary';
import { validateCandidates } from './lookup';

// --- Fixtures ------------------------------------------------------------

function form(text: string, common = false, tags: string[] = [], appliesToKanji?: string[]) {
	return { text, common, tags, ...(appliesToKanji ? { appliesToKanji } : {}) } as DictForm;
}

function sense(glosses: string[], misc: string[] = [], appliesToKanji?: string[]): DictSense {
	return { pos: ['n'], misc, glosses, ...(appliesToKanji ? { appliesToKanji } : {}) };
}

function entry(
	id: number,
	kanji: DictForm[],
	kana: DictForm[],
	senses: DictSense[]
): DictionaryEntry {
	return {
		id,
		common: [...kanji, ...kana].some((f) => f.common),
		kanji,
		kana,
		senses
	};
}

const NINKI = entry(
	1367010,
	[form('人気', true)],
	[form('にんき', true)],
	[sense(['popularity', 'public favor']), sense(['condition (e.g. market)', 'tone'])]
);
const HITOKE = entry(
	1367020,
	[form('人気')],
	[form('ひとけ'), form('ひとげ')],
	[sense(['sign of life', 'human presence']), sense(['humanity', 'humaneness'])]
);
const JINKI = entry(
	2153960,
	[form('人気')],
	[form('じんき')],
	[sense(['prevailing mood of a locality'])]
);

const HASHI_BRIDGE = entry(1237410, [form('橋', true)], [form('はし', true)], [sense(['bridge'])]);
const HASHI_CHOPSTICKS = entry(
	1476410,
	[form('箸', true)],
	[form('はし', true)],
	[sense(['chopsticks'])]
);
// Common as くちばし; its はし reading is not common.
const HASHI_BEAK = entry(
	1565560,
	[form('嘴', true), form('觜')],
	[form('くちばし', true), form('はし')],
	[sense(['beak', 'bill'])]
);
const HASHI_END = entry(
	1581610,
	[form('端', true)],
	[form('はし', true), form('はじ', true)],
	[sense(['end (e.g. of street)', 'tip']), sense(['beginning', 'start']), sense(['odds and ends'])]
);

const TABERU = entry(
	1358280,
	[form('食べる', true), form('喰べる')],
	[form('たべる', true)],
	[sense(['to eat']), sense(['to live on (e.g. a salary)'])]
);
// Usually written in kana: kana input must not be "corrected" to the kanji.
const ARU = entry(
	1296400,
	[form('有る', true), form('在る', true)],
	[form('ある', true)],
	[sense(['to be', 'to exist'], ['uk']), sense(['to have'])]
);
const KIBISHII = entry(
	1262530,
	[form('厳しい', true), form('酷しい')],
	[form('きびしい', true)],
	[
		sense(['severe', 'strict', 'rigid']),
		sense(['hard (to do)', 'difficult']),
		sense(['intense (e.g. cold)', 'harsh'])
	]
);
const T_SHIRT = entry(
	2000001,
	[form('Ｔシャツ', true)],
	[form('ティーシャツ', true)],
	[sense(['T-shirt'])]
);

describe('foldKey', () => {
	it('folds fullwidth Latin like the input path does', () => {
		expect(foldKey('Ｔシャツ')).toBe('Tシャツ');
		expect(foldKey('食べる')).toBe('食べる');
	});
});

describe('toDictionaryRow', () => {
	const word: JmdictWord = {
		id: '1358280',
		kanji: [{ common: true, text: '食べる', tags: [] }],
		kana: [
			{ common: true, text: 'たべる', tags: [], appliesToKanji: ['*'] },
			{ common: false, text: 'タベル', tags: ['rk'], appliesToKanji: ['食べる'] }
		],
		sense: [
			{
				partOfSpeech: ['v1', 'vt'],
				appliesToKanji: ['*'],
				misc: [],
				gloss: [{ text: 'to eat' }]
			},
			{
				partOfSpeech: ['v1', 'vt'],
				appliesToKanji: ['食べる'],
				misc: [],
				gloss: [{ text: 'to live on' }, { text: 'to subsist on' }]
			}
		]
	};

	it('slims a jmdict-simplified word', () => {
		const row = toDictionaryRow(word, '2026-11-16');
		expect(row.id).toBe(1358280);
		expect(row.common).toBe(true);
		expect(row.dict_version).toBe('2026-11-16');
		expect(row.senses[0]).toEqual({ pos: ['v1', 'vt'], misc: [], glosses: ['to eat'] });
		expect(row.senses[1].appliesToKanji).toEqual(['食べる']);
	});

	it('omits the "applies to every form" marker but keeps real restrictions', () => {
		const row = toDictionaryRow(word, 'v');
		expect(row.kana[0]).not.toHaveProperty('appliesToKanji');
		expect(row.kana[1].appliesToKanji).toEqual(['食べる']);
	});

	it('keys the entry on every folded form, once each', () => {
		const row = toDictionaryRow(
			{
				...word,
				kanji: [{ common: false, text: 'Ｔシャツ', tags: [] }],
				kana: [{ common: false, text: 'Tシャツ', tags: [], appliesToKanji: ['*'] }]
			},
			'v'
		);
		expect(row.lookup_keys).toEqual(['Tシャツ']);
		expect(row.common).toBe(false);
	});
});

describe('glossFor', () => {
	it('takes the first gloss of each of the first three senses', () => {
		expect(glossFor(KIBISHII.senses)).toBe('severe; hard (to do); intense (e.g. cold)');
	});

	it('drops whole trailing parts to stay under the length limit', () => {
		const long = 'x'.repeat(60);
		const gloss = glossFor([sense([long]), sense([`${long}2`]), sense(['short'])]);
		expect(gloss).toBe(long);
	});

	it('skips repeated glosses', () => {
		expect(glossFor([sense(['bridge']), sense(['bridge'])])).toBe('bridge');
	});

	it('is empty when there are no glosses', () => {
		expect(glossFor([])).toBe('');
	});
});

describe('buildCandidates', () => {
	it('lists homographs common first, then the uncommon ones, with their own readings', () => {
		const result = buildCandidates('人気', [JINKI, HITOKE, NINKI]);
		expect(result.map((c) => c.reading)).toEqual(['にんき', 'ひとけ', 'じんき']);
		expect(result[0]).toEqual({
			target: '人気',
			reading: 'にんき',
			gloss: 'popularity; condition (e.g. market)'
		});
	});

	it('shows kana input as the usual kanji spelling', () => {
		expect(buildCandidates('たべる', [TABERU])).toEqual([
			{ target: '食べる', reading: 'たべる', gloss: 'to eat; to live on (e.g. a salary)' }
		]);
	});

	it('keeps a usually-kana word in kana', () => {
		expect(buildCandidates('ある', [ARU])[0].target).toBe('ある');
	});

	it('does not pick a rare kanji form for kana input', () => {
		const rare = entry(
			1,
			[form('亦', false, ['rK']), form('又', true)],
			[form('また', true)],
			[sense(['again'])]
		);
		expect(buildCandidates('また', [rare])[0].target).toBe('又');
	});

	it('ranks by the matched form’s own commonness, not the entry’s', () => {
		const result = buildCandidates('はし', [HASHI_BEAK, HASHI_END, HASHI_BRIDGE, HASHI_CHOPSTICKS]);
		expect(result.map((c) => c.target)).toEqual(['橋', '箸', '端', '嘴']);
	});

	it('uses the typed kanji spelling, with the reading that belongs to it', () => {
		const result = buildCandidates('端', [HASHI_END]);
		expect(result).toEqual([
			{
				target: '端',
				reading: 'はし',
				gloss: 'end (e.g. of street); beginning; odds and ends'
			}
		]);
	});

	it('matches ASCII input against the fullwidth form JMdict stores', () => {
		const result = buildCandidates('Tシャツ', [T_SHIRT]);
		expect(result).toEqual([{ target: 'Tシャツ', reading: 'ティーシャツ', gloss: 'T-shirt' }]);
	});

	it('leaves out senses restricted to other kanji forms', () => {
		const mixed = entry(
			2,
			[form('厳めしい'), form('厳しい')],
			[form('いかめしい')],
			[sense(['stern', 'grave']), sense(['strict (e.g. security)'], [], ['厳しい'])]
		);
		expect(buildCandidates('厳めしい', [mixed])[0].gloss).toBe('stern');
		expect(buildCandidates('厳しい', [mixed])[0].gloss).toBe('stern; strict (e.g. security)');
	});

	it('reads a restricted kana form only for the kanji it belongs to', () => {
		const beak = buildCandidates('觜', [
			entry(
				3,
				[form('嘴'), form('觜')],
				[form('くちばし', true, [], ['嘴']), form('はし')],
				[sense(['beak'])]
			)
		]);
		expect(beak[0].reading).toBe('はし');
	});

	it('returns nothing when no form matches', () => {
		expect(buildCandidates('ほげ', [TABERU])).toEqual([]);
	});

	it('produces candidates the shared candidate check accepts', () => {
		const { valid, dropped } = validateCandidates(
			'word',
			buildCandidates('はし', [HASHI_BEAK, HASHI_END, HASHI_BRIDGE, HASHI_CHOPSTICKS])
		);
		expect(dropped).toEqual([]);
		expect(valid.map((c) => c.target)).toEqual(['橋', '箸', '端', '嘴']);
	});
});
