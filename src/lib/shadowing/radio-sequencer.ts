/**
 * Radio mode's "what plays next" logic, kept pure so the repeat/advance/wrap
 * rules are unit-testable apart from the audio element and the timers that
 * drive them in ShadowingRadioActivity.
 */

export const DEFAULT_RADIO_REPEATS = 3;
export const MIN_RADIO_REPEATS = 1;
export const MAX_RADIO_REPEATS = 10;

/**
 * Where radio is in the playlist. `play` is 1-based — the play of
 * `playlist[index]` currently sounding (or about to): 1 is the first time
 * through, `repeats` is the last.
 */
export interface RadioPosition {
	index: number;
	play: number;
}

/** A fresh object each call — callers may keep it in reactive state, so a shared instance must never be handed out. */
export function startPosition(): RadioPosition {
	return { index: 0, play: 1 };
}

/**
 * Coerces whatever the repeats control hands us (a number input can yield
 * NaN, a fraction, or an out-of-range value) into a whole number in
 * [MIN_RADIO_REPEATS, MAX_RADIO_REPEATS]. NaN falls back to the default
 * rather than a bound, since "no usable value" shouldn't silently mean 1.
 */
export function clampRepeats(value: number): number {
	if (Number.isNaN(value)) return DEFAULT_RADIO_REPEATS;
	return Math.min(MAX_RADIO_REPEATS, Math.max(MIN_RADIO_REPEATS, Math.round(value)));
}

/**
 * The position to move to once the play at `pos` has finished.
 *
 * - Plays left on this clip: same clip, next play.
 * - Otherwise: the next clip, play 1.
 * - Otherwise (that was the last clip): wrap to the start and report
 *   `cycleEnded`, so the caller can re-fetch the playlist for a fresh pass.
 *
 * `repeats` is read fresh on every call, so lowering it while a clip is
 * mid-way takes effect at the next boundary: if the clip has already been
 * heard `repeats` or more times, it simply advances. Raising it extends the
 * current clip. `repeats` must come from `clampRepeats`: Infinity would
 * never leave the first clip, and NaN or anything below 1 behaves as 1.
 *
 * An empty playlist, or a position past the end of a playlist that has
 * since shrunk (e.g. a clip was flagged and removed), also counts as the
 * end of a cycle — the wrap is the only position that's always valid. The
 * caller must handle a still-empty playlist after re-fetching, or it would
 * re-fetch in a tight loop.
 */
export function nextPosition(
	pos: RadioPosition,
	playlistLength: number,
	repeats: number
): { pos: RadioPosition; cycleEnded: boolean } {
	if (playlistLength <= 0 || pos.index >= playlistLength) {
		return { pos: startPosition(), cycleEnded: true };
	}
	if (pos.play < repeats) {
		return { pos: { index: pos.index, play: pos.play + 1 }, cycleEnded: false };
	}
	if (pos.index + 1 < playlistLength) {
		return { pos: { index: pos.index + 1, play: 1 }, cycleEnded: false };
	}
	return { pos: startPosition(), cycleEnded: true };
}
