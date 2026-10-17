/**
 * Shared types for the target-practice activity (see
 * notes/target-practice-design.md §3 and §5). Types only — the runtime
 * checks that enforce them live in validate-card.ts / validate-items.ts,
 * which take `unknown` because the data comes from a model.
 */

export const TARGET_TYPES = ['word', 'kanji', 'set_phrase', 'grammar', 'contrast'] as const;
export type TargetType = (typeof TARGET_TYPES)[number];

export const PHASE_IDS = [
	'understand',
	'sense',
	'reading',
	'situation',
	'sort',
	'produce',
	'use',
	'contrast'
] as const;
export type PhaseId = (typeof PHASE_IDS)[number];

/** `contrastKind` is hidden from the learner; it picks the item mix. */
export const CONTRAST_KINDS = [
	'transitivity_pair',
	'near_synonym',
	'grammar',
	'similar_kanji'
] as const;
export type ContrastKind = (typeof CONTRAST_KINDS)[number];

// --- Cards ---------------------------------------------------------------

export interface WordSense {
	/** Stable id other_sense:<n> distractor tags and sense:<n> coverage keys refer to. */
	id: number;
	gloss: string;
	example: string;
}

export interface WordCard {
	ok: true;
	type: 'word';
	target: string;
	reading: string;
	rule: string;
	modelSentences: string[];
	senses: WordSense[];
	forms: string[];
	/** Senses beyond the (max 4) covered ones; shown as "N less common senses not covered". */
	lessCommonSenses: number;
}

export interface KanjiReading {
	/** Kana only, no okurigana punctuation — `と`, not `と(く)`. */
	kana: string;
	kind: 'on' | 'kun';
	okurigana?: string;
	rare: boolean;
}

export interface KanjiCompound {
	word: string;
	reading: string;
	gloss: string;
}

export interface KanjiCard {
	ok: true;
	type: 'kanji';
	target: string;
	rule: string;
	modelSentences: string[];
	meaning: string;
	readings: KanjiReading[];
	compounds: KanjiCompound[];
}

export interface SetPhraseVariant {
	text: string;
	note: string;
}

export interface SetPhraseCard {
	ok: true;
	type: 'set_phrase';
	target: string;
	reading: string;
	rule: string;
	modelSentences: string[];
	meaning: string;
	uses: string[];
	variants: SetPhraseVariant[];
	register: string;
	watchOuts: string[];
}

export interface GrammarCard {
	ok: true;
	type: 'grammar';
	target: string;
	reading: string;
	rule: string;
	modelSentences: string[];
	form: string;
	use: string;
	watchOut: string;
	/** Closest neighbour patterns the Contrast phase tells the target apart from. */
	neighbours: string[];
}

export interface ContrastSide {
	form: string;
	reading: string;
	meaning: string;
}

export interface ContrastCard {
	ok: true;
	type: 'contrast';
	/** Display form, e.g. `決める vs 決まる`. */
	target: string;
	rule: string;
	modelSentences: string[];
	axis: string;
	sides: [ContrastSide, ContrastSide];
	commonMistake: string;
	minimalPair: [string, string];
	contrastKind: ContrastKind;
}

export type Card = WordCard | KanjiCard | SetPhraseCard | GrammarCard | ContrastCard;

// --- Items ---------------------------------------------------------------

/** `name` or `name:param`, e.g. `other_sense:3`. See distractor-tags.ts. */
export type DistractorTag = string;

export interface McOption {
	text: string;
	correct: boolean;
	tag?: DistractorTag;
}

interface ItemBase {
	id: string;
	phase: PhaseId;
	/** Spares are validated like primaries but don't count toward minimums or coverage. */
	spare?: boolean;
	/** English task wording. May not contain Japanese script. */
	instruction?: string;
	/** Japanese prompt sentence or dialogue; `＿＿` marks a cloze blank. Requires `kana`. */
	sentence?: string;
	/** Kana reading of `sentence` with the target span masked as TARGET_MASK. */
	kana?: string;
	/** Substring of `sentence` to highlight ("the bold part"). */
	focus?: string;
	/** Why the answer is right; shown on a miss. */
	rationale: string;
	/** Surface form of the target as it appears (may be conjugated). */
	targetSpan: string;
	/** `sense:<id>`, `side:a|b`, or `reading:<hiragana>`; see validate-items.ts. */
	coverage?: string;
}

export interface McItem extends ItemBase {
	kind: 'mc';
	options: McOption[];
}

export interface TypedItem extends ItemBase {
	kind: 'typed';
	/** `cloze` has exactly one blank in `sentence`; `free` has none. */
	form: 'cloze' | 'free';
	/** Short cue shown after the prompt, e.g. `（来る）`. Not part of the sentence. */
	cue?: string;
	/** Canonical answer; must also be in `accepted`. */
	answer: string;
	accepted: string[];
	hint: string;
}

export interface TilesItem extends ItemBase {
	kind: 'tiles';
	/** Tiles in DISPLAY order (a shuffle that differs from every accepted order). */
	tiles: string[];
	/** Every valid full sentence. */
	accepted: string[];
}

export interface ClaudeItem extends ItemBase {
	kind: 'claude';
	/** Exemplar answers, not an answer key. */
	expected: string[];
	/** A "write your own sentence" item; `expected` may be empty. */
	free?: boolean;
}

export type Item = McItem | TypedItem | TilesItem | ClaudeItem;
