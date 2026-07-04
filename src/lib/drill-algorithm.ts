/**
 * Deterministic drill algorithm: due-word selection and box transitions.
 * Ports CLAUDE.md's "Session algorithm" and "Drill loop" sections exactly.
 * Pure data in, data out — no I/O, no LLM, no Supabase.
 */

export interface VocabEntry {
	word: string;
	frequencyRank: number;
}

export interface WordState {
	word: string;
	box: number; // 0-4
	lastSession: number;
}

export type DrillItem = { word: string; isNew: false; box: number } | { word: string; isNew: true };

const BOX_INTERVALS: Record<number, number> = {
	0: 1,
	1: 2,
	2: 4,
	3: 8,
	4: 16
};

function isDue(wordState: WordState, sessionIndex: number): boolean {
	return sessionIndex - wordState.lastSession >= BOX_INTERVALS[wordState.box];
}

/**
 * Selects this session's drill words: due review words (weakest box first,
 * capped at `limit`), then new words from vocabMaster to fill any remaining
 * slots. Box 4 words are never pulled in early just to fill a slot — they
 * only appear here when genuinely due.
 */
export function selectDrillWords(
	vocabMaster: VocabEntry[],
	wordStates: WordState[],
	sessionIndex: number,
	limit = 10
): DrillItem[] {
	const dueWords = wordStates
		.filter((ws) => isDue(ws, sessionIndex))
		.sort((a, b) => a.box - b.box)
		.slice(0, limit)
		.map((ws): DrillItem => ({ word: ws.word, isNew: false, box: ws.box }));

	if (dueWords.length >= limit) {
		return dueWords;
	}

	const trackedWords = new Set(wordStates.map((ws) => ws.word));
	const newWords = vocabMaster
		.filter((entry) => !trackedWords.has(entry.word))
		.sort((a, b) => a.frequencyRank - b.frequencyRank)
		.slice(0, limit - dueWords.length)
		.map((entry): DrillItem => ({ word: entry.word, isNew: true }));

	return [...dueWords, ...newWords];
}

export interface DrillOutcome {
	/** Current box, or undefined for a word not yet in word_state (new word). */
	box: number | undefined;
	correct: boolean;
	sessionIndex: number;
}

export interface DrillResult {
	box: number;
	lastSession: number;
}

/**
 * Computes the next box + last_session for a word given the outcome of
 * drilling it this session.
 */
export function applyOutcome({ box, correct, sessionIndex }: DrillOutcome): DrillResult {
	if (box === undefined) {
		return { box: correct ? 1 : 0, lastSession: sessionIndex };
	}
	if (correct) {
		return { box: Math.min(box + 1, 4), lastSession: sessionIndex };
	}
	return { box: 0, lastSession: sessionIndex };
}
