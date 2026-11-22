import { selectDrillWords, type WordState } from '$lib/drill-algorithm';

/** Structural subset of the server's ChunkLibraryEntry — kept local so this stays a pure, client-importable module. */
export interface RadioLibraryEntry {
	chunkId: string;
	frequencyRank: number;
}

/**
 * The full-library listening order for radio mode: every chunk exactly
 * once, in the same priority order a drill session would pick them in —
 * due chunks first (round-robin across boxes, most overdue first), then
 * never-heard chunks in introduction order, then not-yet-due chunks
 * closest-to-due first.
 *
 * Reuses `selectDrillWords` unchanged with `limit = library.length` and no
 * new-slot reservation (there's no per-session cap to protect against, so
 * `minNewSlots` has nothing to guard). `sessionIndex` should be the
 * caller's "next" session index (latest + 1), same as session/start uses —
 * but unlike session/start, radio never persists it.
 *
 * Callers must pass `states` already restricted to the current library
 * (see fetchShadowingChunkStates): selectDrillWords' not-yet-due fallback
 * reads progress directly with no cross-check against the library, so a
 * state row for a flagged/removed chunk would otherwise leak into the
 * playlist. As a second layer, this function drops any such id itself.
 */
export function orderRadioPlaylist(
	library: RadioLibraryEntry[],
	states: WordState[],
	sessionIndex: number
): string[] {
	if (library.length === 0) return [];
	const libraryIds = new Set(library.map((entry) => entry.chunkId));
	const libraryStates = states.filter((state) => libraryIds.has(state.word));
	// Same chunkId -> word mapping session/start does: selectDrillWords is
	// activity-agnostic and treats the chunk id as an opaque "word".
	const vocab = library.map((entry) => ({
		word: entry.chunkId,
		frequencyRank: entry.frequencyRank
	}));
	return selectDrillWords(vocab, libraryStates, sessionIndex, library.length, 0).map(
		(item) => item.word
	);
}
