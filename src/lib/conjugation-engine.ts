/**
 * Deterministic conjugation engine: computes the canonical correct form for
 * a (word, word class, form) cell. Pure data in, data out — no I/O, no LLM,
 * same spirit as drill-algorithm.ts. Japanese conjugation is regular per
 * class, so this is a good fit for pure functions; grading against this
 * engine's output (exact-match first) is what lets the drill avoid a Claude
 * API call for the common case.
 */

import type { ConjugationWord, VerbClass, WordClass } from './conjugation-word-list';
import {
	cellId,
	COPULA_FORMS,
	type CopulaFormId,
	I_ADJECTIVE_FORMS,
	type IAdjectiveFormId,
	VERB_FORMS,
	type VerbFormId
} from './conjugation-forms';

const GODAN_ROWS: Record<string, { a: string; i: string; e: string; o: string }> = {
	う: { a: 'わ', i: 'い', e: 'え', o: 'お' },
	く: { a: 'か', i: 'き', e: 'け', o: 'こ' },
	ぐ: { a: 'が', i: 'ぎ', e: 'げ', o: 'ご' },
	す: { a: 'さ', i: 'し', e: 'せ', o: 'そ' },
	つ: { a: 'た', i: 'ち', e: 'て', o: 'と' },
	ぬ: { a: 'な', i: 'に', e: 'ね', o: 'の' },
	ぶ: { a: 'ば', i: 'び', e: 'べ', o: 'ぼ' },
	む: { a: 'ま', i: 'み', e: 'め', o: 'も' },
	る: { a: 'ら', i: 'り', e: 'れ', o: 'ろ' }
};

interface BaseForms {
	nai: string;
	ta: string;
	nakatta: string;
	te: string;
	nakute: string;
	potential: string;
	passive: string;
	causative: string;
	volitional: string;
	conditionalBa: string;
	imperative: string;
	masuStem: string;
}

// 行く is the one documented irregular て/た-form: the regular godan_ku rule
// (stem + いて/いた) would produce 行いて/行いた, but the real forms are
// 行って/行った.
function godanTeTa(word: string, ending: string, stem: string): { te: string; ta: string } {
	if (word === '行く') return { te: '行って', ta: '行った' };
	if (ending === 'う' || ending === 'つ' || ending === 'る') {
		return { te: stem + 'って', ta: stem + 'った' };
	}
	if (ending === 'む' || ending === 'ぬ' || ending === 'ぶ') {
		return { te: stem + 'んで', ta: stem + 'んだ' };
	}
	if (ending === 'く') return { te: stem + 'いて', ta: stem + 'いた' };
	if (ending === 'ぐ') return { te: stem + 'いで', ta: stem + 'いだ' };
	// ending === 'す'
	return { te: stem + 'して', ta: stem + 'した' };
}

function godanBaseForms(word: string): BaseForms {
	const ending = word.at(-1) ?? '';
	const stem = word.slice(0, -1);
	const row = GODAN_ROWS[ending];
	const { te, ta } = godanTeTa(word, ending, stem);
	return {
		nai: stem + row.a + 'ない',
		ta,
		nakatta: stem + row.a + 'なかった',
		te,
		nakute: stem + row.a + 'なくて',
		potential: stem + row.e + 'る',
		passive: stem + row.a + 'れる',
		causative: stem + row.a + 'せる',
		volitional: stem + row.o + 'う',
		conditionalBa: stem + row.e + 'ば',
		imperative: stem + row.e,
		masuStem: stem + row.i
	};
}

function ichidanBaseForms(word: string): BaseForms {
	const stem = word.slice(0, -1);
	return {
		nai: stem + 'ない',
		ta: stem + 'た',
		nakatta: stem + 'なかった',
		te: stem + 'て',
		nakute: stem + 'なくて',
		// Potential and passive are deliberately identical (食べられる for
		// both) — a real teaching point for ichidan verbs, not a bug.
		potential: stem + 'られる',
		passive: stem + 'られる',
		causative: stem + 'させる',
		volitional: stem + 'よう',
		conditionalBa: stem + 'れば',
		imperative: stem + 'ろ',
		masuStem: stem
	};
}

function suruBaseForms(word: string): BaseForms {
	const stem = word.slice(0, -2); // drop する; '' for bare する itself
	return {
		nai: stem + 'しない',
		ta: stem + 'した',
		nakatta: stem + 'しなかった',
		te: stem + 'して',
		nakute: stem + 'しなくて',
		potential: stem + 'できる', // suppletive: する's potential is できる, not しれる
		passive: stem + 'される',
		causative: stem + 'させる',
		volitional: stem + 'しよう',
		conditionalBa: stem + 'すれば',
		imperative: stem + 'しろ',
		masuStem: stem + 'し'
	};
}

// 来る changes its kanji reading per form (来ない=konai, 来た=kita, 来る=kuru,
// ...) — irrelevant to the text this engine produces (kanji doesn't encode
// reading), but the word may be written with either the kanji (来る,
// やって来る) or all-kana (くる, やってくる) in the source list, and those
// need different literal suffixes.
function kuruBaseForms(word: string): BaseForms {
	const prefix = word.slice(0, -2);
	if (word.endsWith('来る')) {
		return {
			nai: prefix + '来ない',
			ta: prefix + '来た',
			nakatta: prefix + '来なかった',
			te: prefix + '来て',
			nakute: prefix + '来なくて',
			potential: prefix + '来られる',
			passive: prefix + '来られる',
			causative: prefix + '来させる',
			volitional: prefix + '来よう',
			conditionalBa: prefix + '来れば',
			imperative: prefix + '来い',
			masuStem: prefix + '来'
		};
	}
	return {
		nai: prefix + 'こない',
		ta: prefix + 'きた',
		nakatta: prefix + 'こなかった',
		te: prefix + 'きて',
		nakute: prefix + 'こなくて',
		potential: prefix + 'こられる',
		passive: prefix + 'こられる',
		causative: prefix + 'こさせる',
		volitional: prefix + 'こよう',
		conditionalBa: prefix + 'くれば',
		imperative: prefix + 'こい',
		masuStem: prefix + 'き'
	};
}

function verbBaseForms(word: string, wordClass: VerbClass): BaseForms {
	if (wordClass === 'ichidan') return ichidanBaseForms(word);
	if (wordClass === 'suru') return suruBaseForms(word);
	if (wordClass === 'kuru') return kuruBaseForms(word);
	return godanBaseForms(word); // all 9 godan_* classes share the same row-table logic
}

function dropRu(s: string): string {
	return s.slice(0, -1);
}

/**
 * ある has no regular negative form at all — its negative is the wholly
 * different word ない (irregular suppletion), not the row-table-predicted
 * あらない. Rather than have the engine emit a wrong answer (or the drill UI
 * discover this mid-grading), this cell is excluded from ever being
 * generated for ある — see pickWordForCell below — and conjugate() throws if
 * asked for it directly, so the gap fails loudly during development instead
 * of silently.
 */
function assertConjugatable(word: string, formId: string): void {
	if (word === 'ある' && (formId === 'nai' || formId === 'nakatta' || formId === 'nakute')) {
		throw new Error(
			`ある has no regular ${formId} form (irregular suppletion to ない) — this cell should ` +
				'have been excluded before reaching conjugate(), see pickWordForCell.'
		);
	}
}

export function conjugateVerb(word: string, wordClass: VerbClass, formId: VerbFormId): string {
	assertConjugatable(word, formId);
	const base = verbBaseForms(word, wordClass);
	switch (formId) {
		case 'nai':
			return base.nai;
		case 'ta':
			return base.ta;
		case 'nakatta':
			return base.nakatta;
		case 'te':
			return base.te;
		case 'nakute':
			return base.nakute;
		case 'potential':
			return base.potential;
		case 'passive':
			return base.passive;
		case 'causative':
			return base.causative;
		case 'volitional':
			return base.volitional;
		case 'conditional_ba':
			return base.conditionalBa;
		case 'conditional_tara':
			return base.ta + 'ら';
		case 'imperative':
			return base.imperative;
		case 'tai':
			return base.masuStem + 'たい';
		case 'masu':
			return base.masuStem + 'ます';
		case 'masen':
			return base.masuStem + 'ません';
		case 'mashita':
			return base.masuStem + 'ました';
		case 'masen_deshita':
			return base.masuStem + 'ませんでした';
		case 'potential_negative':
			return dropRu(base.potential) + 'ない';
		case 'potential_past':
			return dropRu(base.potential) + 'た';
		case 'passive_negative':
			return dropRu(base.passive) + 'ない';
		case 'passive_past':
			return dropRu(base.passive) + 'た';
		case 'causative_negative':
			return dropRu(base.causative) + 'ない';
		case 'causative_past':
			return dropRu(base.causative) + 'た';
		case 'causative_passive':
			return dropRu(base.causative) + 'られる';
		case 'causative_passive_past':
			return dropRu(dropRu(base.causative) + 'られる') + 'た';
	}
}

export function conjugateIAdjective(word: string, formId: IAdjectiveFormId): string {
	// いい is a colloquial contraction — every form except the plain
	// dictionary form is built from よい instead (よくない, よかった, ...),
	// not the naively-dropped いくない/いかった.
	const isIrregularGood = word === 'いい' || word === 'よい';
	const stem = isIrregularGood ? 'よ' : word.slice(0, -1);
	switch (formId) {
		case 'negative':
			return stem + 'くない';
		case 'past':
			return stem + 'かった';
		case 'past_negative':
			return stem + 'くなかった';
		case 'te':
			return stem + 'くて';
		case 'negative_te':
			return stem + 'くなくて';
		case 'conditional_kereba':
			return stem + 'ければ';
		case 'adverbial':
			return stem + 'く';
		case 'sou':
			// Two memorized exceptions to the regular stem+そう pattern:
			// いい/よい -> よさそう (not よそう), and any adjective ending in
			// ない -> stem+さそう (少ない -> 少なさそう, not 少ないそう).
			if (isIrregularGood) return 'よさそう';
			if (word.endsWith('ない')) return stem + 'さそう';
			return stem + 'そう';
		case 'polite':
			return word + 'です';
		case 'polite_past':
			return stem + 'かったです';
	}
}

export function conjugateCopula(word: string, formId: CopulaFormId): string {
	switch (formId) {
		case 'negative':
			return word + 'じゃない';
		case 'past':
			return word + 'だった';
		case 'past_negative':
			return word + 'じゃなかった';
		case 'te':
			return word + 'で';
		case 'conditional_nara':
			return word + 'なら';
		case 'desu':
			return word + 'です';
		case 'negative_desu':
			return word + 'じゃないです';
		case 'deshita':
			return word + 'でした';
		case 'past_negative_desu':
			return word + 'じゃなかったです';
	}
}

export function conjugate(word: string, wordClass: WordClass, formId: string): string {
	if (wordClass === 'i_adjective') return conjugateIAdjective(word, formId as IAdjectiveFormId);
	if (wordClass === 'copula') return conjugateCopula(word, formId as CopulaFormId);
	return conjugateVerb(word, wordClass as VerbClass, formId as VerbFormId);
}

export interface ConjugationCell {
	id: string;
	wordClass: WordClass;
	formId: string;
}

const ALL_VERB_CLASSES: VerbClass[] = [
	'godan_u',
	'godan_ku',
	'godan_gu',
	'godan_su',
	'godan_tsu',
	'godan_nu',
	'godan_bu',
	'godan_mu',
	'godan_ru',
	'ichidan',
	'suru',
	'kuru'
];

/**
 * The full (word_class, form) cell registry — progress state is tracked per
 * cell here, independent of which specific word gets drilled for it (see
 * pickWordForCell). ~294 in the original design estimate (25 forms x ~11
 * verb classes + 10 + 9); exactly 319 here (25 x 12 verb classes, since
 * there are 12 not 11 — the estimate was always approximate).
 *
 * Iteration order is form-major, class-minor (not the other way around):
 * this array's index doubles as the "new cell" introduction order for
 * selectDrillWords (the same role vocab's frequencyRank plays), so looping
 * classes-first would drill a learner through godan_u's
 * causative_passive_past before they ever saw a single godan_ku form.
 * Form-major spreads difficulty evenly instead — every class's nai-form
 * before any class's ta-form, and so on — extending VERB_FORMS' own
 * simple-before-compound ordering across the whole curriculum.
 */
export function buildConjugationRegistry(): ConjugationCell[] {
	const cells: ConjugationCell[] = [];
	for (const form of VERB_FORMS) {
		for (const wordClass of ALL_VERB_CLASSES) {
			cells.push({ id: cellId(wordClass, form.id), wordClass, formId: form.id });
		}
	}
	for (const form of I_ADJECTIVE_FORMS) {
		cells.push({ id: cellId('i_adjective', form.id), wordClass: 'i_adjective', formId: form.id });
	}
	for (const form of COPULA_FORMS) {
		cells.push({ id: cellId('copula', form.id), wordClass: 'copula', formId: form.id });
	}
	return cells;
}

function canConjugate(word: string, formId: string): boolean {
	return !(word === 'ある' && (formId === 'nai' || formId === 'nakatta' || formId === 'nakute'));
}

/**
 * Picks one word of `wordClass` to drill for `formId` this instance —
 * progress state (box/interval) lives on the (wordClass, formId) cell, not
 * on any specific word, so the concrete word shown can vary freely between
 * drills. Excludes ある for ある's own irregular-negative cells (see
 * assertConjugatable) rather than ever handing conjugate() a combination it
 * would have to reject.
 */
export function pickWordForCell(
	wordClass: WordClass,
	formId: string,
	words: ConjugationWord[]
): ConjugationWord {
	const candidates = words.filter(
		(w) => w.wordClass === wordClass && w.included && canConjugate(w.word, formId)
	);
	if (candidates.length === 0) {
		throw new Error(`No drillable word available for ${wordClass}/${formId}`);
	}
	return candidates[Math.floor(Math.random() * candidates.length)];
}
