/**
 * Text helpers shared by input validation, item validation and (later)
 * client-side answer grading. Pure.
 */

/** Placeholder the generator puts in the kana line where the target was. */
export const TARGET_MASK = '〇〇';

/** A cloze blank: one or more fullwidth underscores. Match on RAW text — NFKC turns ＿ into _. */
const BLANK_PATTERN = /＿+/g;

const JAPANESE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const LATIN_LETTER = /[A-Za-z]/;

/**
 * Normalize a typed or generated answer for comparison: NFKC, lowercase,
 * then drop whitespace, punctuation, symbols and control characters.
 * Deliberately keeps ー (a letter-modifier, not punctuation) and 〇, and does
 * NOT fold hiragana into katakana or kana into kanji — those variants are
 * listed explicitly in `accepted`.
 */
export function normalizeAnswer(text: string): string {
	return text
		.normalize('NFKC')
		.toLowerCase()
		.replace(/[\p{Z}\p{P}\p{S}\p{Cc}\p{Cf}]/gu, '');
}

export function countBlanks(text: string): number {
	return text.match(BLANK_PATTERN)?.length ?? 0;
}

/** Replace the blank(s) in a cloze sentence with `answer`. */
export function fillBlank(sentence: string, answer: string): string {
	return sentence.replace(BLANK_PATTERN, () => answer);
}

export function hasJapaneseScript(text: string): boolean {
	return JAPANESE_SCRIPT.test(text);
}

export function hasLatinLetter(text: string): boolean {
	return LATIN_LETTER.test(text);
}

/** Katakana -> hiragana (including the ー mark, which both scripts share). */
export function toHiragana(text: string): string {
	return text.replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
}

/** True when `text` is non-empty and made only of kana (plus ー and, optionally, 〜 / ・). */
export function isKana(text: string, { allowPatternMarks = false } = {}): boolean {
	if (text.length === 0) return false;
	const allowed = allowPatternMarks ? /^[ぁ-ゟァ-ヿ〜・]+$/ : /^[ぁ-ゟァ-ヿ]+$/;
	return allowed.test(text);
}
