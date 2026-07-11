import { describe, expect, it } from 'vitest';
import { applyOutcome, selectDrillWords, type VocabEntry, type WordState } from './drill-algorithm';

function vocab(...words: string[]): VocabEntry[] {
	return words.map((word, i) => ({ word, frequencyRank: i + 1 }));
}

function state(word: string, box: number, lastSession: number, box4Streak = 0): WordState {
	return { word, box, lastSession, box4Streak };
}

describe('selectDrillWords: due-interval boundaries', () => {
	it.each([
		[0, 1],
		[1, 2],
		[2, 4],
		[3, 8]
	])('box %i is due exactly at the %i-session interval, not before', (box, interval) => {
		const notYetDue = selectDrillWords(vocab('a'), [state('a', box, 10)], 10 + interval - 1);
		expect(notYetDue).toEqual([]);

		const due = selectDrillWords(vocab('a'), [state('a', box, 10)], 10 + interval);
		expect(due).toEqual([{ word: 'a', isNew: false, box, box4Streak: 0 }]);
	});
});

describe('selectDrillWords: box 4 interval grows with box4Streak', () => {
	it.each([
		[0, 16],
		[1, 17],
		[2, 18],
		[10, 26]
	])(
		'with box4Streak %i, due exactly at the %i-session interval, not before',
		(box4Streak, interval) => {
			const notYetDue = selectDrillWords(
				vocab('a'),
				[state('a', 4, 10, box4Streak)],
				10 + interval - 1
			);
			expect(notYetDue).toEqual([]);

			const due = selectDrillWords(vocab('a'), [state('a', 4, 10, box4Streak)], 10 + interval);
			expect(due).toEqual([{ word: 'a', isNew: false, box: 4, box4Streak }]);
		}
	);
});

describe('selectDrillWords: sort order', () => {
	it('sorts due words lowest-box-first', () => {
		const wordStates = [state('box3', 3, 0), state('box1', 1, 0), state('box2', 2, 0)];
		const result = selectDrillWords(vocab(), wordStates, 100);
		expect(result.map((d) => d.word)).toEqual(['box1', 'box2', 'box3']);
	});

	it('breaks same-box ties by most-overdue (oldest last_session) first', () => {
		const wordStates = [state('newer', 0, 5), state('older', 0, 2)];
		const result = selectDrillWords(vocab(), wordStates, 100);
		expect(result.map((d) => d.word)).toEqual(['older', 'newer']);
	});
});

describe('selectDrillWords: round-robin prevents box-0 starvation', () => {
	it('guarantees higher-box due words a slot even when the box-0 backlog exceeds the limit', () => {
		const box0Words = Array.from({ length: 12 }, (_, i) => state(`box0-${i}`, 0, 0));
		const box2Words = [state('box2-a', 2, 0), state('box2-b', 2, 0)];
		const result = selectDrillWords(vocab(), [...box0Words, ...box2Words], 100, 10);
		expect(result).toHaveLength(10);
		expect(result.map((d) => d.word)).toEqual(expect.arrayContaining(['box2-a', 'box2-b']));
	});
});

describe('selectDrillWords: cap at limit', () => {
	it('takes at most `limit` due words even if more are due', () => {
		const wordStates = ['a', 'b', 'c', 'd', 'e'].map((w) => state(w, 0, 0));
		const result = selectDrillWords(vocab(), wordStates, 1, 3);
		expect(result).toHaveLength(3);
	});
});

describe('selectDrillWords: fill with new words', () => {
	it('fills remaining slots with new words in frequency-rank order when fewer than `limit` are due', () => {
		const vocabMaster = vocab('る1', 'る2', 'る3'); // frequency order
		const wordStates = [state('る1', 0, 5)]; // due, box0 interval=1, session 6 => due
		const result = selectDrillWords(vocabMaster, wordStates, 6, 3);
		expect(result).toEqual([
			{ word: 'る1', isNew: false, box: 0, box4Streak: 0 },
			{ word: 'る2', isNew: true },
			{ word: 'る3', isNew: true }
		]);
	});

	it('excludes already-tracked words from the new-word fill', () => {
		const vocabMaster = vocab('tracked', 'untracked');
		// tracked word is box4, not due (interval 16, only 1 session elapsed) — should not appear
		const wordStates = [state('tracked', 4, 0)];
		const result = selectDrillWords(vocabMaster, wordStates, 1, 10);
		expect(result).toEqual([{ word: 'untracked', isNew: true }]);
	});

	it('does not fill beyond the available vocab when there are not enough new words', () => {
		const vocabMaster = vocab('only-new-word');
		const result = selectDrillWords(vocabMaster, [], 1, 10);
		expect(result).toEqual([{ word: 'only-new-word', isNew: true }]);
	});
});

describe('selectDrillWords: minNewSlots guarantee', () => {
	it('reserves minNewSlots for new items even when due backlog exceeds limit', () => {
		const vocabMaster = vocab('due1', 'due2', 'due3', 'due4', 'due5', 'new1', 'new2');
		// 5 due words, all box0 (due every session) — backlog exceeds the
		// 3-slot due budget (limit 5 - minNewSlots 2) on its own.
		const wordStates = ['due1', 'due2', 'due3', 'due4', 'due5'].map((w) => state(w, 0, 0));
		const result = selectDrillWords(vocabMaster, wordStates, 1, 5, 2);
		expect(result).toHaveLength(5);
		expect(result.filter((d) => d.isNew)).toHaveLength(2);
		expect(result.filter((d) => !d.isNew)).toHaveLength(3);
	});

	it('yields fewer than minNewSlots new items when vocabMaster runs out, without shorting due review', () => {
		const vocabMaster = vocab('due1', 'new1');
		const wordStates = [state('due1', 0, 0)];
		const result = selectDrillWords(vocabMaster, wordStates, 1, 5, 3);
		expect(result).toEqual(
			expect.arrayContaining([
				{ word: 'due1', isNew: false, box: 0, box4Streak: 0 },
				{ word: 'new1', isNew: true }
			])
		);
		expect(result).toHaveLength(2);
	});

	it('does not reserve new slots once every word has already been introduced, so due review gets the full session budget', () => {
		const vocabMaster = vocab('a', 'b', 'c', 'd', 'e');
		// All 5 words already tracked (fully introduced) and due — with no
		// untracked words left, minNewSlots must not shrink the due budget,
		// or these sessions would permanently review fewer than `limit` words
		// forever even though nothing is left to reserve slots for.
		const wordStates = ['a', 'b', 'c', 'd', 'e'].map((w) => state(w, 0, 0));
		const result = selectDrillWords(vocabMaster, wordStates, 1, 5, 3);
		expect(result).toHaveLength(5);
		expect(result.every((d) => !d.isNew)).toBe(true);
	});

	it('reproduces current behavior exactly when minNewSlots is omitted (default 0)', () => {
		const box0Words = Array.from({ length: 12 }, (_, i) => state(`box0-${i}`, 0, 0));
		const box2Words = [state('box2-a', 2, 0), state('box2-b', 2, 0)];
		const result = selectDrillWords(vocab(), [...box0Words, ...box2Words], 100, 10);
		expect(result).toHaveLength(10);
		expect(result.map((d) => d.word)).toEqual(expect.arrayContaining(['box2-a', 'box2-b']));
	});
});

describe('selectDrillWords: box 4 is never forced in early', () => {
	it('omits a not-yet-due box4 word even when slots need filling', () => {
		const vocabMaster = vocab('box4word');
		// box4 interval is 16; only 1 session has elapsed, so not due
		const wordStates = [state('box4word', 4, 0)];
		const result = selectDrillWords(vocabMaster, wordStates, 1, 10);
		// box4word is also the only vocab entry and is already tracked, so no new words either
		expect(result).toEqual([]);
	});
});

describe('applyOutcome: box transitions for tracked words', () => {
	it('increments box on a correct answer', () => {
		expect(applyOutcome({ box: 2, correct: true, sessionIndex: 7 })).toEqual({
			box: 3,
			lastSession: 7,
			box4Streak: 0
		});
	});

	it('caps the box at 4 on a correct answer', () => {
		expect(applyOutcome({ box: 4, box4Streak: 0, correct: true, sessionIndex: 7 })).toEqual({
			box: 4,
			lastSession: 7,
			box4Streak: 1
		});
	});

	it('steps the box down by 1 on an incorrect answer, rather than resetting to 0', () => {
		expect(applyOutcome({ box: 3, correct: false, sessionIndex: 7 })).toEqual({
			box: 2,
			lastSession: 7,
			box4Streak: 0
		});
	});

	it('floors the box at 0 on an incorrect answer', () => {
		expect(applyOutcome({ box: 0, correct: false, sessionIndex: 7 })).toEqual({
			box: 0,
			lastSession: 7,
			box4Streak: 0
		});
	});

	it('updates last_session to the current session_index regardless of outcome', () => {
		expect(applyOutcome({ box: 1, correct: true, sessionIndex: 42 }).lastSession).toBe(42);
		expect(applyOutcome({ box: 1, correct: false, sessionIndex: 42 }).lastSession).toBe(42);
	});
});

describe('applyOutcome: new word first exposure', () => {
	it('jumps a new word straight to the max box if correct on first exposure', () => {
		expect(applyOutcome({ box: undefined, correct: true, sessionIndex: 5 })).toEqual({
			box: 4,
			lastSession: 5,
			box4Streak: 0
		});
	});

	it('starts a new word at box 0 if incorrect on first exposure', () => {
		expect(applyOutcome({ box: undefined, correct: false, sessionIndex: 5 })).toEqual({
			box: 0,
			lastSession: 5,
			box4Streak: 0
		});
	});
});

describe('applyOutcome: box4Streak growth and reset', () => {
	it('grows box4Streak by 1 on each consecutive correct answer while staying at box 4', () => {
		const first = applyOutcome({ box: 4, box4Streak: 0, correct: true, sessionIndex: 20 });
		expect(first.box4Streak).toBe(1);

		const second = applyOutcome({
			box: 4,
			box4Streak: first.box4Streak,
			correct: true,
			sessionIndex: 37
		});
		expect(second.box4Streak).toBe(2);
	});

	it('resets box4Streak to 0 the instant a box-4 word is answered incorrectly', () => {
		const result = applyOutcome({ box: 4, box4Streak: 5, correct: false, sessionIndex: 20 });
		expect(result).toEqual({ box: 3, lastSession: 20, box4Streak: 0 });
	});

	it('starts box4Streak at 0 when a word is freshly promoted into box 4 from below', () => {
		const result = applyOutcome({ box: 3, box4Streak: 0, correct: true, sessionIndex: 20 });
		expect(result).toEqual({ box: 4, lastSession: 20, box4Streak: 0 });
	});

	it('starts box4Streak fresh at 0 when a word re-enters box 4 after a prior slip, ignoring any stale streak value', () => {
		// Stale box4Streak from before the earlier drop to box 3 must not leak
		// back in once the word climbs back up to box 4.
		const result = applyOutcome({ box: 3, box4Streak: 7, correct: true, sessionIndex: 20 });
		expect(result).toEqual({ box: 4, lastSession: 20, box4Streak: 0 });
	});

	it('leaves box4Streak at 0 for boxes below 4 regardless of outcome', () => {
		expect(
			applyOutcome({ box: 1, box4Streak: 0, correct: true, sessionIndex: 20 }).box4Streak
		).toBe(0);
	});
});
