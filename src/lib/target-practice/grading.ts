import { fillBlank, normalizeAnswer } from './normalize';
import type { Item, McItem, TilesItem, TypedItem } from './types';

/**
 * Local grading (design doc §7): `mc` and `tiles` are graded here, `typed`
 * tries an exact match against the accepted list first. Whatever the match
 * can't settle goes to Claude (the grade route) — never decided here.
 */

/** Index of the option the learner chose; a missing one is simply wrong. */
export function gradeMc(item: McItem, chosen: number): boolean {
	return item.options[chosen]?.correct === true;
}

/** The correct option's text, for showing the key after a miss. */
export function correctOption(item: McItem): string {
	return item.options.find((o) => o.correct)?.text ?? '';
}

/** Placed tiles joined and compared after punctuation-stripping normalization. */
export function gradeTiles(item: TilesItem, placed: string[]): boolean {
	const answer = normalizeAnswer(placed.join(''));
	return answer !== '' && item.accepted.some((a) => normalizeAnswer(a) === answer);
}

/**
 * Exact match against the accepted answers (normalized: NFKC, case, spaces and
 * punctuation ignored). A cloze also accepts the whole sentence typed out with
 * the blank filled in, which learners do.
 */
export function gradeTyped(item: TypedItem, answer: string): boolean {
	const typed = normalizeAnswer(answer);
	if (typed === '') return false;
	if (item.accepted.some((a) => normalizeAnswer(a) === typed)) return true;
	if (item.form === 'cloze' && item.sentence) {
		const sentence = item.sentence;
		return item.accepted.some((a) => normalizeAnswer(fillBlank(sentence, a)) === typed);
	}
	return false;
}

/** What the hint ladder does after a typed submission that was not accepted. */
export function typedNext(attempt: 1 | 2): 'hint' | 'reveal' {
	return attempt === 1 ? 'hint' : 'reveal';
}

/** The key to show after a miss or a neutral result: the canonical answer, or an exemplar. */
export function answerText(item: Item): string {
	switch (item.kind) {
		case 'mc':
			return correctOption(item);
		case 'typed':
			return item.answer;
		case 'tiles':
			return item.accepted[0] ?? '';
		case 'claude':
			return item.expected[0] ?? '';
	}
}
