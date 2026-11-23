import { isKana } from './normalize';
import type { Candidate } from './lookup';

/**
 * Word lookup against a local copy of JMdict (design doc §2 step 2, as revised:
 * the dictionary replaces the Word candidate model call). Pure and
 * relative-import only, because scripts/import-dictionary.ts (run by tsx, which
 * has no `$lib` alias) shares `toDictionaryRow` with the lookup route.
 *
 * JMdict is the Electronic Dictionary Research and Development Group's data,
 * used under their licence (CC BY-SA 4.0) — see README.md for the credit line.
 * The app reads it from the `dictionary_entries` table; nothing here touches
 * the network or the database.
 */

const MAX_GLOSS_LENGTH = 100;
/** Senses that feed the picker's one-line gloss. */
const GLOSS_SENSES = 3;

// --- Stored shape --------------------------------------------------------

export interface DictForm {
	text: string;
	/** JMdict's "common" priority flag for this specific form. */
	common: boolean;
	/** JMdict tags, e.g. `rK` (rarely used kanji form). */
	tags: string[];
	/** Kana forms only: which kanji forms this reading belongs to; omitted when all. */
	appliesToKanji?: string[];
}

export interface DictSense {
	/** Parts of speech, e.g. `v1`, `adj-i`, `n`. */
	pos: string[];
	/** Misc tags; `uk` = usually written in kana. */
	misc: string[];
	glosses: string[];
	/** Omitted when the sense applies to every kanji form. */
	appliesToKanji?: string[];
}

/** What the lookup reads back; the row minus its bookkeeping columns. */
export interface DictionaryEntry {
	id: number;
	common: boolean;
	kanji: DictForm[];
	kana: DictForm[];
	senses: DictSense[];
}

export interface DictionaryRow extends DictionaryEntry {
	/** NFKC-folded text of every written and kana form: the lookup key. */
	lookup_keys: string[];
	dict_version: string;
}

/** The slice of a jmdict-simplified word the import reads. Untrusted file contents. */
export interface JmdictWord {
	id: string | number;
	kanji: { common: boolean; text: string; tags: string[] }[];
	kana: { common: boolean; text: string; tags: string[]; appliesToKanji: string[] }[];
	sense: {
		partOfSpeech: string[];
		appliesToKanji: string[];
		misc: string[];
		gloss: { text: string }[];
	}[];
}

/**
 * JMdict stores Latin letters fullwidth (Ｔシャツ, ＳＮＳ); the input path folds
 * them with NFKC (cleanInput), so the lookup key is folded the same way.
 */
export function foldKey(text: string): string {
	return text.normalize('NFKC');
}

function everyKanji(applies: string[] | undefined): boolean {
	return !applies || applies.length === 0 || applies.includes('*');
}

/** Slims one jmdict-simplified word into the stored row. */
export function toDictionaryRow(word: JmdictWord, dictVersion: string): DictionaryRow {
	const kanji: DictForm[] = word.kanji.map((k) => ({
		text: k.text,
		common: k.common,
		tags: k.tags
	}));
	const kana: DictForm[] = word.kana.map((k) => ({
		text: k.text,
		common: k.common,
		tags: k.tags,
		...(everyKanji(k.appliesToKanji) ? {} : { appliesToKanji: k.appliesToKanji })
	}));
	const senses: DictSense[] = word.sense.map((s) => ({
		pos: s.partOfSpeech,
		misc: s.misc,
		glosses: s.gloss.map((g) => g.text),
		...(everyKanji(s.appliesToKanji) ? {} : { appliesToKanji: s.appliesToKanji })
	}));
	return {
		id: Number(word.id),
		common: kanji.some((k) => k.common) || kana.some((k) => k.common),
		kanji,
		kana,
		senses,
		lookup_keys: [...new Set([...kanji, ...kana].map((f) => foldKey(f.text)))],
		dict_version: dictVersion
	};
}

// --- Building the picker's candidates -----------------------------------

/** Tags that make a form a poor choice to show a learner as "the" spelling or reading. */
const RARE_KANJI_TAGS = ['rK', 'iK', 'oK', 'sK'];
const RARE_KANA_TAGS = ['rk', 'ik', 'ok', 'sk'];

function hasAny(tags: string[], wanted: string[]): boolean {
	return tags.some((t) => wanted.includes(t));
}

interface Match {
	entry: DictionaryEntry;
	kind: 'kanji' | 'kana';
	form: DictForm;
}

function matchEntry(entry: DictionaryEntry, key: string): Match | null {
	const kanji = entry.kanji.find((f) => foldKey(f.text) === key);
	if (kanji) return { entry, kind: 'kanji', form: kanji };
	const kana = entry.kana.find((f) => foldKey(f.text) === key);
	if (kana) return { entry, kind: 'kana', form: kana };
	return null;
}

function kanaFitsKanji(kana: DictForm, kanjiText: string): boolean {
	return everyKanji(kana.appliesToKanji) || kana.appliesToKanji!.includes(kanjiText);
}

/** The reading shown for a kanji form: its first ordinary applicable kana form. */
function readingForKanji(entry: DictionaryEntry, kanjiText: string): string | null {
	const fitting = entry.kana.filter((k) => kanaFitsKanji(k, kanjiText));
	const preferred = fitting.find((k) => !hasAny(k.tags, RARE_KANA_TAGS)) ?? fitting[0];
	return preferred?.text ?? null;
}

/**
 * The spelling a learner normally sees. A kanji match keeps that spelling.
 * Kana input resolves to the entry's first ordinary kanji form (たべる → 食べる),
 * unless the word is usually written in kana (ある, ください) or has no kanji.
 */
function pickTarget(match: Match): { target: string; reading: string } | null {
	const { entry, kind, form } = match;
	if (kind === 'kanji') {
		const reading = readingForKanji(entry, form.text);
		return reading ? { target: foldKey(form.text), reading } : null;
	}
	const usuallyKana = entry.senses[0]?.misc.includes('uk') ?? false;
	const kanji = usuallyKana
		? undefined
		: entry.kanji.find((k) => !hasAny(k.tags, RARE_KANJI_TAGS) && kanaFitsKanji(form, k.text));
	return { target: foldKey(kanji ? kanji.text : form.text), reading: form.text };
}

function sensesFor(match: Match): DictSense[] {
	if (match.kind !== 'kanji') return match.entry.senses;
	return match.entry.senses.filter(
		(s) => everyKanji(s.appliesToKanji) || s.appliesToKanji!.includes(match.form.text)
	);
}

/**
 * One line to tell homographs apart: the first gloss of each of the first few
 * senses (厳しい → "severe; hard (to do); intense (e.g. cold)"), kept under the
 * length the candidate check allows by dropping whole trailing parts.
 */
export function glossFor(senses: DictSense[]): string {
	const parts: string[] = [];
	for (const sense of senses.slice(0, GLOSS_SENSES)) {
		const first = sense.glosses[0]?.trim();
		if (first && !parts.includes(first)) parts.push(first);
	}
	while (parts.length > 1 && parts.join('; ').length > MAX_GLOSS_LENGTH) parts.pop();
	return parts.join('; ').slice(0, MAX_GLOSS_LENGTH);
}

/**
 * Turns the entries a typed word matched into picker candidates: forms the typed
 * text matches exactly, ordered common first (by the matched form's own flag, so
 * はし ranks 橋 above 嘴, whose common reading is くちばし), then uncommon ones
 * (ひとけ), then JMdict's own order. Not capped here: `validateCandidates` runs
 * over the result as the shared trust boundary, drops invalid or duplicate
 * candidates and applies the cap, so a dropped one doesn't leave the picker short.
 */
export function buildCandidates(typed: string, entries: DictionaryEntry[]): Candidate[] {
	const key = foldKey(typed);
	const matches = entries
		.map((entry) => matchEntry(entry, key))
		.filter((m): m is Match => m !== null)
		.sort(
			(a, b) =>
				Number(b.form.common) - Number(a.form.common) ||
				Number(b.entry.common) - Number(a.entry.common) ||
				a.entry.id - b.entry.id
		);

	const candidates: Candidate[] = [];
	for (const match of matches) {
		const picked = pickTarget(match);
		if (!picked || !isKana(picked.reading, { allowPatternMarks: true })) continue;
		const gloss = glossFor(sensesFor(match));
		if (gloss === '') continue;
		candidates.push({ target: picked.target, reading: picked.reading, gloss });
	}
	return candidates;
}
