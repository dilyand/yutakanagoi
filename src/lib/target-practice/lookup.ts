import { hasLatinLetter, isKana, normalizeAnswer, toHiragana } from './normalize';
import { validateTargetInput } from './input-validation';
import { validateCard } from './validate-card';
import type { CardCheck } from './validate-card';
import type { Card, TargetType } from './types';

/**
 * Pure pieces of the lookup step (design doc §2 steps 2-3, §14 step 4): the
 * candidate picker's validation, the confirmed target that grounds the card
 * call, the check on the model's card result, the history key, and the
 * response shapes shared by the lookup/history routes and the (later) UI.
 * Everything here takes `unknown` from a model or a client and never throws.
 */

export const MAX_CANDIDATES = 4;
export const MAX_GLOSS_LENGTH = 100;

// --- Candidates ----------------------------------------------------------

export interface Candidate {
	/** Japanese form: dictionary form for a word, `〜`-notation for a pattern. */
	target: string;
	/** Kana reading. */
	reading: string;
	/** One-line English gloss. */
	gloss: string;
}

export interface CandidateCheck {
	valid: Candidate[];
	dropped: { index: number; reason: string }[];
}

function readingKey(reading: string): string {
	return toHiragana(reading).replace(/[〜・]/g, '');
}

/**
 * Keeps the usable candidates from a model's list: each target must be valid
 * Japanese input for the type (so the card call can take it as-is), with a
 * kana reading and an English gloss. Deduped on target + reading — same
 * spelling with a different reading (人気 にんき/ひとけ) is the whole point of
 * the picker — and capped at MAX_CANDIDATES, keeping the model's order.
 */
export function validateCandidates(type: TargetType, raw: unknown[]): CandidateCheck {
	const valid: Candidate[] = [];
	const dropped: CandidateCheck['dropped'] = [];
	const seen = new Set<string>();

	raw.forEach((entry, index) => {
		const reason = (() => {
			if (typeof entry !== 'object' || entry === null) return 'not an object';
			const { target, reading, gloss } = entry as Record<string, unknown>;
			if (typeof target !== 'string' || typeof reading !== 'string' || typeof gloss !== 'string') {
				return 'target, reading and gloss must be strings';
			}
			const check = validateTargetInput(type, target);
			if (!check.ok) return `target "${target}" is not valid for ${type}: ${check.message}`;
			if (check.language !== 'ja') return `target "${target}" is not Japanese`;
			if (!isKana(reading.trim(), { allowPatternMarks: true })) return 'reading must be kana only';
			const cleanGloss = gloss.trim();
			if (!hasLatinLetter(cleanGloss) || cleanGloss.length > MAX_GLOSS_LENGTH) {
				return `gloss must be English text of at most ${MAX_GLOSS_LENGTH} characters`;
			}
			const key = `${normalizeAnswer(check.value)}|${readingKey(reading.trim())}`;
			if (seen.has(key)) return 'duplicate candidate';
			if (valid.length >= MAX_CANDIDATES) return `more than ${MAX_CANDIDATES} candidates`;
			seen.add(key);
			valid.push({ target: check.value, reading: reading.trim(), gloss: cleanGloss });
			return null;
		})();
		if (reason) dropped.push({ index, reason });
	});

	return { valid, dropped };
}

// --- Confirmed target ----------------------------------------------------

/** What the card call is grounded in: the learner's confirmed pick. */
export interface ConfirmedTarget {
	type: TargetType;
	/** Cleaned, validated Japanese target (Contrast: `a vs b`). */
	target: string;
	/** Contrast only: the two sides, in the order typed. */
	sides?: [string, string];
	/** Set when the target came from a candidate; identifies the word among homographs. */
	reading?: string;
	gloss?: string;
}

export type ConfirmResult =
	{ ok: true; confirmed: ConfirmedTarget } | { ok: false; message: string };

/**
 * The card route's trust boundary: re-validates the client-supplied target
 * exactly as the input screen did (it must be Japanese — English goes through
 * the candidate step first), and bounds the optional candidate `reading` and
 * `gloss`, which come from the model via the client and are untrusted.
 */
export function confirmTarget(
	type: TargetType,
	input: { target: string; reading?: string; gloss?: string }
): ConfirmResult {
	const check = validateTargetInput(type, input.target);
	if (!check.ok) return { ok: false, message: check.message };
	if (check.language !== 'ja') {
		return {
			ok: false,
			message: 'The card is built from the Japanese target — pick a candidate first.'
		};
	}
	const confirmed: ConfirmedTarget = { type, target: check.value };
	if (check.sides) confirmed.sides = check.sides;

	if (input.reading !== undefined || input.gloss !== undefined) {
		if (type !== 'word' && type !== 'grammar') {
			return { ok: false, message: 'Only Word and Grammar targets carry a candidate reading.' };
		}
		const reading = input.reading?.trim();
		const gloss = input.gloss?.trim();
		if (reading !== undefined) {
			if (!isKana(reading, { allowPatternMarks: true })) {
				return { ok: false, message: 'The reading must be kana only.' };
			}
			confirmed.reading = reading;
		}
		if (gloss !== undefined) {
			if (!hasLatinLetter(gloss) || gloss.length > MAX_GLOSS_LENGTH) {
				return { ok: false, message: 'The gloss must be short English text.' };
			}
			confirmed.gloss = gloss;
		}
	}
	return { ok: true, confirmed };
}

// --- The card result -----------------------------------------------------

/**
 * The model's card result with `ok`/`type`/`target` already stripped from the
 * accepted branch (the server adds them, so the target can't drift and the
 * structured-output schema has no literals — see schemas.ts).
 */
export type ModelCardResult =
	| { ok: true; card: Record<string, unknown> }
	| { ok: false; reason: string; suggestedType: string };

/**
 * Turns the model's result into a CardCheck: re-attaches `ok`/`type`/`target`,
 * runs validateCard (which also handles the `ok: false` redirect with its
 * suggested type, and rejects a similar_kanji Contrast), then holds the card to
 * the confirmed target — the candidate's reading, and Contrast's sides in the
 * typed order (coverage `side:a` means the first side typed).
 */
export function checkCardResult(result: ModelCardResult, confirmed: ConfirmedTarget): CardCheck {
	if (!result.ok) {
		return validateCard(
			{ ok: false, reason: result.reason, suggestedType: result.suggestedType },
			confirmed.type
		);
	}
	const raw = { ...result.card, ok: true, type: confirmed.type, target: confirmed.target };
	const checked = validateCard(raw, confirmed.type);
	if (checked.status !== 'ok') return checked;

	const problems = groundingProblems(checked.card, confirmed);
	return problems.length > 0 ? { status: 'invalid', problems } : checked;
}

function groundingProblems(card: Card, confirmed: ConfirmedTarget): string[] {
	const problems: string[] = [];
	if (confirmed.reading !== undefined && 'reading' in card) {
		if (readingKey(card.reading) !== readingKey(confirmed.reading)) {
			problems.push(`card reading ${card.reading} differs from the confirmed ${confirmed.reading}`);
		}
	}
	if (card.type === 'contrast' && confirmed.sides) {
		confirmed.sides.forEach((side, i) => {
			if (normalizeAnswer(card.sides[i].form) !== normalizeAnswer(side)) {
				problems.push(`card side ${i + 1} is ${card.sides[i].form}, expected ${side}`);
			}
		});
	}
	return problems;
}

// --- History key ---------------------------------------------------------

/**
 * The canonical resolved target a history row is keyed on (not the learner's
 * typing). Word adds the reading, so homographs (人気 にんき / ひとけ) don't
 * overwrite each other; Contrast is keyed on the display form as typed.
 */
export function targetKey(card: Card): string {
	return card.type === 'word' ? `${card.target}|${readingKey(card.reading)}` : card.target;
}

// --- Response shapes -----------------------------------------------------

/** A usage-cap or kill-switch hit: a normal outcome (HTTP 200), not an error. */
export interface LimitOutcome {
	status: 'limit';
	reason: 'disabled' | 'cap_reached';
	/** ISO timestamp the UTC-day counters reset; the UI formats it in local time. */
	resetsAt: string;
	message: string;
}

export type CandidatesResponse =
	{ status: 'ok'; candidates: Candidate[] } | { status: 'none' } | LimitOutcome;

export type CardResponse =
	| { status: 'ok'; card: Card }
	| { status: 'rejected'; reason: string; suggestedType?: TargetType }
	| LimitOutcome;

export interface RecentTarget {
	type: TargetType;
	targetKey: string;
	card: Card;
	lastPracticedAt: string;
}
