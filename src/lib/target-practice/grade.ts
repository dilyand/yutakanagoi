import type { LimitOutcome } from './lookup';
import type { ClaudeItem, Item, TypedItem } from './types';

/**
 * Shapes shared by the grade route and the client (design doc §7, decision 11):
 * list-shaped input so batching stays a trivial switch, and a result per input
 * that is either a verdict or `null` — the neutral "couldn't check" path.
 */

export const MAX_GRADE_ITEMS = 4;
export const MAX_FEEDBACK_LENGTH = 400;

export type GradeInput =
	| {
			/** A typed answer the exact match rejected: is it an acceptable alternative? */
			mode: 'typed';
			instruction: string;
			sentence: string;
			cue: string;
			answer: string;
			accepted: string[];
			learnerAnswer: string;
	  }
	| {
			/** A Use-phase item: does the learner's reply do the task, using the target well? */
			mode: 'use';
			instruction: string;
			sentence: string;
			expected: string[];
			free: boolean;
			learnerAnswer: string;
	  };

export interface GradeVerdict {
	correct: boolean;
	/** One or two sentences for the learner, in English. */
	feedback: string;
}

export interface GradeOk {
	status: 'ok';
	/** One entry per input, in order; `null` where no usable verdict came back. */
	results: (GradeVerdict | null)[];
}

export type GradeResponse = GradeOk | LimitOutcome;

/** The grade input for an item the learner answered, or null for kinds graded locally. */
export function toGradeInput(item: Item, learnerAnswer: string): GradeInput | null {
	if (item.kind === 'typed') return typedInput(item, learnerAnswer);
	if (item.kind === 'claude') return useInput(item, learnerAnswer);
	return null;
}

function typedInput(item: TypedItem, learnerAnswer: string): GradeInput {
	return {
		mode: 'typed',
		instruction: item.instruction ?? '',
		sentence: item.sentence ?? '',
		cue: item.cue ?? '',
		answer: item.answer,
		accepted: item.accepted,
		learnerAnswer
	};
}

function useInput(item: ClaudeItem, learnerAnswer: string): GradeInput {
	return {
		mode: 'use',
		instruction: item.instruction ?? '',
		sentence: item.sentence ?? '',
		expected: item.expected,
		free: item.free === true,
		learnerAnswer
	};
}

/**
 * Turns the model's parsed output into exactly `count` entries. Anything not
 * shaped like a verdict becomes null (neutral) — a short or garbled list must
 * never be read as "correct".
 */
export function checkGradeResults(raw: unknown, count: number): (GradeVerdict | null)[] {
	const list =
		typeof raw === 'object' && raw !== null && Array.isArray((raw as { results?: unknown }).results)
			? ((raw as { results: unknown[] }).results as unknown[])
			: [];
	return Array.from({ length: count }, (_, i) => {
		const entry = list[i];
		if (typeof entry !== 'object' || entry === null) return null;
		const { correct, feedback } = entry as Record<string, unknown>;
		if (typeof correct !== 'boolean' || typeof feedback !== 'string') return null;
		const text = feedback.trim().slice(0, MAX_FEEDBACK_LENGTH);
		return text === '' ? null : { correct, feedback: text };
	});
}
