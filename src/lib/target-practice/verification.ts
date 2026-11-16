import type { GradeVerdict } from './grade';
import { MAX_FEEDBACK_LENGTH } from './grade';
import type { Item, McItem } from './types';

/**
 * Pure pieces of the two verification passes (design doc §6 "Contrast
 * verification", extended after the first Preview test run: learners cannot
 * tell "wrong" from "merely odd", so flags are no quality net):
 *
 * 1. a generation-time check of Grammar's spot-the-error Contrast items — is the
 *    marked sentence unambiguously wrong, and are the other three unambiguously
 *    fine? — which drops an item on any doubt;
 * 2. a second look before a grader REJECTION is shown — is the reason valid, and
 *    would a native accept the answer? — which can overturn the rejection.
 *
 * Both take `unknown` from a model and never throw. Both fail OPEN: a garbled or
 * missing answer keeps the item / keeps the first verdict, so a verification
 * outage never makes the product worse than it was without the pass.
 */

// --- Contrast verification -------------------------------------------------

export interface VerifyFailure {
	id: string;
	/** One short sentence on what is doubtful, for the log. */
	problem: string;
}

/** The mc items a spot-the-error verification covers (Grammar, phase contrast). */
export function contrastItemsToVerify(items: Item[]): McItem[] {
	return items.filter((i): i is McItem => i.kind === 'mc' && i.phase === 'contrast');
}

/**
 * The model's results → the items to drop. An item with no (or a malformed)
 * result is kept, and so is an id that was never asked about.
 */
export function checkVerifyResults(raw: unknown, items: { id: string }[]): VerifyFailure[] {
	const list =
		typeof raw === 'object' && raw !== null && Array.isArray((raw as { results?: unknown }).results)
			? ((raw as { results: unknown[] }).results as unknown[])
			: [];
	const known = new Set(items.map((i) => i.id));
	const failures: VerifyFailure[] = [];
	for (const entry of list) {
		if (typeof entry !== 'object' || entry === null) continue;
		const { id, ok, problem } = entry as Record<string, unknown>;
		if (typeof id !== 'string' || !known.has(id) || ok !== false) continue;
		failures.push({
			id,
			problem: typeof problem === 'string' ? problem.trim().slice(0, 300) : ''
		});
	}
	return failures;
}

// --- Second look at a rejection ---------------------------------------------

export interface ReviewVerdict {
	/** The answer is acceptable: the rejection should be overturned. */
	acceptable: boolean;
	/** One or two sentences for the learner. */
	feedback: string;
}

/** The model's review results → exactly `count` entries, null where unusable. */
export function checkReviewResults(raw: unknown, count: number): (ReviewVerdict | null)[] {
	const list =
		typeof raw === 'object' && raw !== null && Array.isArray((raw as { results?: unknown }).results)
			? ((raw as { results: unknown[] }).results as unknown[])
			: [];
	return Array.from({ length: count }, (_, i) => {
		const entry = list[i];
		if (typeof entry !== 'object' || entry === null) return null;
		const { acceptable, feedback } = entry as Record<string, unknown>;
		if (typeof acceptable !== 'boolean' || typeof feedback !== 'string') return null;
		const text = feedback.trim().slice(0, MAX_FEEDBACK_LENGTH);
		return text === '' ? null : { acceptable, feedback: text };
	});
}

/**
 * Applies reviews to first-pass verdicts. `rejected` lists the indices that were
 * reviewed, in the order of `reviews`. An unusable review (null) leaves the first
 * verdict as it was; a usable one replaces the feedback (the reviewer verified the
 * reasoning, so its text is the better explanation either way) and, when it finds
 * the answer acceptable, flips the verdict to correct. Returns the new list and
 * the indices that were overturned.
 */
export function applyReviews(
	verdicts: (GradeVerdict | null)[],
	rejected: number[],
	reviews: (ReviewVerdict | null)[]
): { verdicts: (GradeVerdict | null)[]; overturned: number[] } {
	const out = [...verdicts];
	const overturned: number[] = [];
	rejected.forEach((index, n) => {
		const first = verdicts[index];
		const review = reviews[n];
		if (!first || first.correct || !review) return;
		out[index] = { correct: review.acceptable, feedback: review.feedback };
		if (review.acceptable) overturned.push(index);
	});
	return { verdicts: out, overturned };
}

/** Indices of the verdicts a review should look at: the rejections. */
export function rejectedIndices(verdicts: (GradeVerdict | null)[]): number[] {
	return verdicts.flatMap((v, i) => (v && !v.correct ? [i] : []));
}
