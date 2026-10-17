import { normalizeAnswer } from './normalize';
import type { TargetType } from './types';

/**
 * Local validation of what the learner types, run before any API call
 * (design doc §2). It only rejects what can be decided without a dictionary;
 * type mismatches that need judgment ("this looks like grammar") are the card
 * call's job.
 */

export const MAX_INPUT_LENGTH = 40;

export type InputLanguage = 'ja' | 'en';

export type InputCheck =
	| {
			ok: true;
			type: TargetType;
			/** Cleaned input: trimmed, NFKC-normalized, wave dashes unified to 〜. */
			value: string;
			language: InputLanguage;
			/** English input must go through the candidate step to find the Japanese target. */
			needsCandidates: boolean;
			/** Contrast only: the two sides, in the order typed. */
			sides?: [string, string];
	  }
	| { ok: false; message: string };

const KANA = '\\u3041-\\u309F\\u30A1-\\u30FF';
// Han ideographs only — excludes 々 and 〇, which \p{Script=Han} would include.
const IDEOGRAPH = '\\p{Unified_Ideograph}';
const JA_WORD_CHARS = `${KANA}${IDEOGRAPH}々ー`;

const JA_WORD = new RegExp(`^[${JA_WORD_CHARS}]+$`, 'u');
const JA_PHRASE = new RegExp(`^[${JA_WORD_CHARS}、！？・]+$`, 'u');
const JA_PATTERN = new RegExp(`^[${JA_WORD_CHARS}〜（）]+$`, 'u');
const SINGLE_IDEOGRAPH = new RegExp(`^${IDEOGRAPH}$`, 'u');
const EN_WORD = /^[A-Za-z][A-Za-z'’-]*$/;
const EN_PATTERN_CHARS = /^[A-Za-z][A-Za-z\s,'’-]*$/;

const JA_ANY = new RegExp(`[${KANA}${IDEOGRAPH}]`, 'u');
const LATIN_ANY = /[A-Za-z]/;

const MAX_EN_WORD_TOKENS = 3;
const MAX_EN_PATTERN_TOKENS = 8;

/** NFKC, trim, collapse whitespace, unify ~ / ～ / ∼ into 〜. */
export function cleanInput(raw: string): string {
	return raw
		.normalize('NFKC')
		.replace(/[~∼〰]/g, '〜')
		.replace(/\s+/g, ' ')
		.trim();
}

function reject(message: string): InputCheck {
	return { ok: false, message };
}

export function validateTargetInput(type: TargetType, raw: string): InputCheck {
	const value = cleanInput(raw);
	if (value === '') return reject('Type something first.');
	if ([...value].length > MAX_INPUT_LENGTH) {
		return reject(`Keep it to ${MAX_INPUT_LENGTH} characters or fewer.`);
	}
	switch (type) {
		case 'kanji':
			return checkKanji(value);
		case 'word':
			return checkWord(value);
		case 'set_phrase':
			return checkSetPhrase(value);
		case 'grammar':
			return checkGrammar(value);
		case 'contrast':
			return checkContrast(value);
	}
}

function checkKanji(value: string): InputCheck {
	if (SINGLE_IDEOGRAPH.test(value)) {
		return { ok: true, type: 'kanji', value, language: 'ja', needsCandidates: false };
	}
	if ([...value].length > 1) {
		return reject('Kanji takes exactly one character. Compounds are Words — pick Word instead.');
	}
	return reject('Enter one kanji character, for example 解 or 憂.');
}

function checkWord(value: string): InputCheck {
	if (JA_ANY.test(value) && LATIN_ANY.test(value)) {
		return reject('Use Japanese or English, not both.');
	}
	if (JA_ANY.test(value)) {
		if (/\s/.test(value)) return reject('Word takes a single word, with no spaces.');
		if (value.includes('〜')) return reject('A pattern with a slot is Grammar, not a Word.');
		if (!JA_WORD.test(value)) return reject('A Word is kana and kanji only — no punctuation.');
		return { ok: true, type: 'word', value, language: 'ja', needsCandidates: false };
	}
	const tokens = value.split(' ');
	if (tokens.length > MAX_EN_WORD_TOKENS || !tokens.every((t) => EN_WORD.test(t))) {
		return reject(
			'Word takes a single word (like "deadline" or "to run"). For a phrase use Set phrase; for a pattern use Grammar.'
		);
	}
	return { ok: true, type: 'word', value, language: 'en', needsCandidates: true };
}

function checkSetPhrase(value: string): InputCheck {
	if (LATIN_ANY.test(value)) return reject('Set phrases are entered in Japanese.');
	if (/[〜…]/.test(value)) {
		return reject('If it has a slot you fill in, it is Grammar. A set phrase is fixed text.');
	}
	if (/[。]/.test(value) || /\s/.test(value)) {
		return reject('Enter just the expression — no spaces, and no full stop.');
	}
	if (!JA_PHRASE.test(value)) return reject('A set phrase is kana and kanji only.');
	if ([...value].length < 2) return reject('A set phrase is more than one character.');
	return { ok: true, type: 'set_phrase', value, language: 'ja', needsCandidates: false };
}

function checkGrammar(value: string): InputCheck {
	if (JA_ANY.test(value) && LATIN_ANY.test(value)) {
		return reject('Use Japanese or English, not both.');
	}
	if (JA_ANY.test(value)) {
		if (/[。！？]$/.test(value) || /\s/.test(value)) {
			return reject('Enter the pattern itself, like 〜てしまう — not a full sentence.');
		}
		if (!JA_PATTERN.test(value)) return reject('A grammar pattern is kana, kanji and 〜 only.');
		return { ok: true, type: 'grammar', value, language: 'ja', needsCandidates: false };
	}
	const tokens = value.split(' ');
	if (!EN_PATTERN_CHARS.test(value) || tokens.length < 2 || tokens.length > MAX_EN_PATTERN_TOKENS) {
		return reject(
			'Describe the pattern in a few English words (like "whether or not") or enter it in Japanese (like 〜かどうか).'
		);
	}
	return { ok: true, type: 'grammar', value, language: 'en', needsCandidates: true };
}

// --- Contrast ------------------------------------------------------------

const EXPLICIT_SEPARATOR = /\s*(?:\bvs\.?(?=\s|$)|[/、,，])\s*/giu;

/**
 * Split `決める vs 決まる`-style input into its two sides. Explicit
 * separators (`vs`, `/`, `、`, `,`) win. Failing that, exactly two
 * whitespace-separated tokens work. `と` is deliberately NOT a separator: it
 * is a genuine part of many words (ところ, とき, 止まる), so treating it as one
 * would make them unenterable.
 */
export function parseContrastInput(
	raw: string
): { ok: true; sides: [string, string] } | { ok: false; message: string } {
	const value = cleanInput(raw);
	const parts = splitSides(value);
	if (!parts.ok) return parts;
	const [a, b] = parts.sides;
	if (a === '' || b === '') return { ok: false, message: 'Both sides need something in them.' };
	if (normalizeAnswer(a) === normalizeAnswer(b)) {
		return { ok: false, message: 'The two sides are the same — enter two different items.' };
	}
	return { ok: true, sides: [a, b] };
}

function splitSides(
	value: string
): { ok: true; sides: [string, string] } | { ok: false; message: string } {
	const explicit = value.split(EXPLICIT_SEPARATOR);
	if (explicit.length === 2) return { ok: true, sides: [explicit[0].trim(), explicit[1].trim()] };
	if (explicit.length > 2) return { ok: false, message: 'Contrast takes exactly two items.' };

	const spaced = value.split(' ');
	if (spaced.length === 2) return { ok: true, sides: [spaced[0], spaced[1]] };
	if (spaced.length > 2) return { ok: false, message: 'Contrast takes exactly two items.' };

	return {
		ok: false,
		message: 'Separate the two items with "vs" or "/", like 決める vs 決まる.'
	};
}

function checkContrast(value: string): InputCheck {
	if (LATIN_ANY.test(value.replace(/\bvs\.?(?=\s|$)/giu, ''))) {
		return reject(
			'Contrast is Japanese only. If you only know the English, look the words up with Word first.'
		);
	}
	const parsed = parseContrastInput(value);
	if (!parsed.ok) return reject(parsed.message);
	for (const side of parsed.sides) {
		if (!new RegExp(`^[${JA_WORD_CHARS}〜（）]+$`, 'u').test(side)) {
			return reject('Each side should be kana and kanji only.');
		}
	}
	return {
		ok: true,
		type: 'contrast',
		value: `${parsed.sides[0]} vs ${parsed.sides[1]}`,
		language: 'ja',
		needsCandidates: false,
		sides: parsed.sides
	};
}
