import { nextBox4Streak } from '$lib/drill-algorithm';

/**
 * Shadowing drill has no correct/incorrect signal to grade against — the
 * rating is derived from how far up the in-app hint ladder the user
 * climbed before advancing, not self-reported. Hints are monotonic (once
 * revealed, always visible), so the rating is a function of the highest
 * rung reached.
 *
 * hintLevel 0 — audio only, straight to Next   -> 'easy'
 * hintLevel 1 — Japanese text requested        -> 'good'
 * hintLevel 2 — kana requested                 -> 'hard'
 * hintLevel 3 — English requested               -> 'very_hard' (floor —
 *   English sits below kana on the ladder, but there's no rung under it
 *   to rate any lower)
 */
export type ShadowingRating = 'easy' | 'good' | 'hard' | 'very_hard';

export function ratingForHintLevel(hintLevel: number): ShadowingRating {
	if (hintLevel <= 0) return 'easy';
	if (hintLevel === 1) return 'good';
	if (hintLevel === 2) return 'hard';
	return 'very_hard';
}

export interface ShadowingOutcome {
	/** Current box, or undefined for a chunk not yet in shadowing_state (new chunk). */
	box: number | undefined;
	box4Streak?: number;
	rating: ShadowingRating;
	sessionIndex: number;
}

export interface ShadowingResult {
	box: number;
	lastSession: number;
	box4Streak: number;
}

const MAX_BOX = 4;

/**
 * Its own box-transition rule, with direct precedent in
 * conjugation-engine.ts's applyConjugationOutcome — an activity-specific
 * rule reusing nextBox4Streak from drill-algorithm.ts rather than that
 * module's binary correct/incorrect applyOutcome, since shadowing's four
 * rating levels don't map onto a binary outcome.
 *
 * easy jumping a brand-new chunk straight to box 4 mirrors vocab's
 * "already knew it" rule — repeating an unfamiliar sentence with no text
 * at all is a real demonstration of comprehension. very_hard drops two
 * boxes rather than resetting to 0, matching CLAUDE.md's vocab rule that a
 * single slip shouldn't erase all prior progress, while still landing
 * meaningfully harder than a plain `hard`.
 */
export function applyShadowingOutcome({
	box,
	box4Streak,
	rating,
	sessionIndex
}: ShadowingOutcome): ShadowingResult {
	let newBox: number;
	if (box === undefined) {
		newBox = rating === 'easy' ? MAX_BOX : rating === 'good' ? 1 : 0;
	} else if (rating === 'easy' || rating === 'good') {
		newBox = Math.min(box + 1, MAX_BOX);
	} else if (rating === 'hard') {
		newBox = Math.max(box - 1, 0);
	} else {
		newBox = Math.max(box - 2, 0);
	}

	return {
		box: newBox,
		lastSession: sessionIndex,
		box4Streak: nextBox4Streak(box, box4Streak, rating === 'easy', newBox)
	};
}
