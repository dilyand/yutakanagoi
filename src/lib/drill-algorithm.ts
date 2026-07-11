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
	box: number; // 0-MAX_BOX
	lastSession: number;
	/** Consecutive correct reviews since most recently entering box 4 — 0
	 *  while box < 4, reset to 0 the instant it drops out of box 4. Grows
	 *  box 4's due interval (see effectiveInterval) so long-mastered words
	 *  space out further over time instead of staying flat at 16 sessions
	 *  forever. */
	box4Streak: number;
}

export type DrillItem =
	{ word: string; isNew: false; box: number; box4Streak: number } | { word: string; isNew: true };

const MAX_BOX = 4;

const BOX_INTERVALS: Record<number, number> = {
	0: 1,
	1: 2,
	2: 4,
	3: 8,
	4: 16
};

/**
 * Box 4's interval grows by one session per additional correct review while
 * still at box 4 (16, 17, 18, ...) — deliberately gentle linear growth, not
 * exponential, so long-mastered words drift further apart over time without
 * effectively vanishing from rotation. Every other box stays flat, same as
 * before.
 */
function effectiveInterval(box: number, box4Streak: number): number {
	return box === MAX_BOX ? BOX_INTERVALS[MAX_BOX] + box4Streak : BOX_INTERVALS[box];
}

function isDue(wordState: WordState, sessionIndex: number): boolean {
	return (
		sessionIndex - wordState.lastSession >= effectiveInterval(wordState.box, wordState.box4Streak)
	);
}

/**
 * Picks up to `limit` due words round-robin across boxes 0->MAX_BOX (most
 * overdue first within a box), so a large box-0 backlog can't monopolize
 * every slot and starve higher-box reviews indefinitely. Box 0 is still
 * drawn from first every cycle, so weaker words remain the priority.
 */
function pickDueWordsRoundRobin(dueWords: WordState[], limit: number): WordState[] {
	const buckets: WordState[][] = [];
	for (let box = 0; box <= MAX_BOX; box++) {
		buckets.push(
			dueWords.filter((ws) => ws.box === box).sort((a, b) => a.lastSession - b.lastSession)
		);
	}

	const picked: WordState[] = [];
	let remaining = dueWords.length;
	while (picked.length < limit && remaining > 0) {
		for (const bucket of buckets) {
			if (picked.length >= limit) break;
			const next = bucket.shift();
			if (next) {
				picked.push(next);
				remaining--;
			}
		}
	}
	return picked;
}

/**
 * Reserved for both activities' session-start endpoints (see
 * MIN_NEW_SLOTS_PER_SESSION below): vocab's bundled master list has ~2000
 * words, conjugation's registry has 319 cells — both bigger than
 * `limit * 16` (box 4's base interval), so both can hit the same ceiling
 * where review-only demand permanently saturates the session limit and no
 * new item is ever introduced again. See CHANGELOG 2.2.1.
 */
export const MIN_NEW_SLOTS_PER_SESSION = 3;

/**
 * Selects this session's drill words: due review words (weakest box first,
 * capped at `limit`), then new words from vocabMaster to fill any remaining
 * slots. Box 4 words are never pulled in early just to fill a slot — they
 * only appear here when genuinely due.
 *
 * `minNewSlots` (default 0, so callers that omit it are unaffected) reserves
 * up to that many of `limit`'s slots for never-before-seen items regardless
 * of due-review backlog size — but only as many as actually remain
 * untracked. Once every word/cell has been introduced at least once, the
 * reservation drops to 0 automatically so due review gets the full `limit`
 * back, rather than permanently wasting slots that have nothing left to
 * reserve them for.
 */
export function selectDrillWords(
	vocabMaster: VocabEntry[],
	wordStates: WordState[],
	sessionIndex: number,
	limit = 10,
	minNewSlots = 0
): DrillItem[] {
	const trackedWords = new Set(wordStates.map((ws) => ws.word));
	const availableNewWords = vocabMaster
		.filter((entry) => !trackedWords.has(entry.word))
		.sort((a, b) => a.frequencyRank - b.frequencyRank);

	const reservedNewSlots = Math.min(minNewSlots, availableNewWords.length);
	const dueWords = pickDueWordsRoundRobin(
		wordStates.filter((ws) => isDue(ws, sessionIndex)),
		Math.max(limit - reservedNewSlots, 0)
	).map((ws): DrillItem => ({
		word: ws.word,
		isNew: false,
		box: ws.box,
		box4Streak: ws.box4Streak
	}));

	const newWords = availableNewWords
		.slice(0, limit - dueWords.length)
		.map((entry): DrillItem => ({ word: entry.word, isNew: true }));

	return [...dueWords, ...newWords];
}

export interface DrillOutcome {
	/** Current box, or undefined for a word not yet in word_state (new word). */
	box: number | undefined;
	/** Current box4Streak, or undefined for a word not yet in word_state. */
	box4Streak?: number;
	correct: boolean;
	sessionIndex: number;
}

export interface DrillResult {
	box: number;
	lastSession: number;
	box4Streak: number;
}

/**
 * Computes the next box4Streak given the prior box/streak, this review's
 * outcome, and the box it lands on. Only grows when the word was already at
 * box 4, answered correctly, and stays at box 4 — every other case (fresh
 * entry into box 4, a wrong answer, still climbing below box 4) resets to 0.
 * Exported so conjugation-engine.ts's applyConjugationOutcome — which has
 * its own box-transition rules — can reuse this exact piece rather than
 * duplicating it.
 */
export function nextBox4Streak(
	priorBox: number | undefined,
	priorBox4Streak: number | undefined,
	correct: boolean,
	newBox: number
): number {
	if (correct && priorBox === MAX_BOX && newBox === MAX_BOX) {
		return (priorBox4Streak ?? 0) + 1;
	}
	return 0;
}

/**
 * Computes the next box + last_session for a word given the outcome of
 * drilling it this session.
 */
export function applyOutcome({
	box,
	box4Streak,
	correct,
	sessionIndex
}: DrillOutcome): DrillResult {
	const newBox =
		box === undefined
			? correct
				? MAX_BOX
				: 0
			: correct
				? Math.min(box + 1, MAX_BOX)
				: Math.max(box - 1, 0);
	return {
		box: newBox,
		lastSession: sessionIndex,
		box4Streak: nextBox4Streak(box, box4Streak, correct, newBox)
	};
}
