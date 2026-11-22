import { describe, expect, it } from 'vitest';
import { orderRadioPlaylist } from './radio-playlist';
import type { WordState } from '$lib/drill-algorithm';

function library(n: number) {
	return Array.from({ length: n }, (_, i) => ({ chunkId: `c${i}`, frequencyRank: i }));
}

function state(word: string, box: number, lastSession: number, box4Streak = 0): WordState {
	return { word, box, lastSession, box4Streak };
}

describe('orderRadioPlaylist', () => {
	it('returns [] for an empty library', () => {
		expect(orderRadioPlaylist([], [], 5)).toEqual([]);
	});

	it('returns every chunk exactly once (a permutation of the library)', () => {
		const lib = library(40);
		const states = [
			state('c3', 0, 1),
			state('c7', 2, 1),
			state('c9', 4, 1),
			state('c12', 4, 30, 3),
			state('c20', 1, 31)
		];
		const result = orderRadioPlaylist(lib, states, 32);
		expect(result).toHaveLength(40);
		expect(new Set(result).size).toBe(40);
		expect(new Set(result)).toEqual(new Set(lib.map((l) => l.chunkId)));
	});

	it('is not capped at 10 like a drill session', () => {
		expect(orderRadioPlaylist(library(25), [], 1)).toHaveLength(25);
	});

	it('orders never-heard chunks by introduction order when there is no progress', () => {
		expect(orderRadioPlaylist(library(4), [], 1)).toEqual(['c0', 'c1', 'c2', 'c3']);
	});

	it('puts due chunks before new chunks, and new chunks before not-yet-due ones', () => {
		const lib = library(5);
		// session 10: c2 (box 0, last 5) is due; c1 (box 4, last 9) is not yet due; c0/c3/c4 are new.
		const states = [state('c2', 0, 5), state('c1', 4, 9)];
		expect(orderRadioPlaylist(lib, states, 10)).toEqual(['c2', 'c0', 'c3', 'c4', 'c1']);
	});

	it('orders not-yet-due chunks closest-to-due first', () => {
		const lib = library(3);
		// session 10, all box 3 (interval 8): c0 last 9 (due in 7), c1 last 4 (due in 2), c2 last 8 (due in 6).
		const states = [state('c0', 3, 9), state('c1', 3, 4), state('c2', 3, 8)];
		expect(orderRadioPlaylist(lib, states, 10)).toEqual(['c1', 'c2', 'c0']);
	});

	it('draws due chunks round-robin across boxes, weakest box first', () => {
		const lib = library(4);
		// Deliberately listed newest-first within each box, so the expected
		// order below only holds if "most overdue (oldest lastSession) first"
		// is actually applied, not just input order.
		const states = [state('c3', 1, 2), state('c2', 0, 2), state('c0', 1, 1), state('c1', 0, 1)];
		// all due at session 20: box 0 (c1, c2), box 1 (c0, c3); cycle 1 takes c1 then c0, cycle 2 c2 then c3.
		expect(orderRadioPlaylist(lib, states, 20)).toEqual(['c1', 'c0', 'c2', 'c3']);
	});

	it("applies box 4's growing interval: a streak pushes a chunk from due to not-yet-due", () => {
		const lib = library(3);
		// session 20, both box 4 last seen at 1 (19 sessions ago): streak 3 -> interval 19 -> due;
		// streak 4 -> interval 20 -> not yet due. c2 is never heard.
		const states = [state('c1', 4, 1, 4), state('c0', 4, 1, 3)];
		expect(orderRadioPlaylist(lib, states, 20)).toEqual(['c0', 'c2', 'c1']);
	});

	it('ignores state rows for chunks outside the library', () => {
		const lib = library(2);
		const states = [state('gone', 0, 1), state('c0', 0, 1)];
		const result = orderRadioPlaylist(lib, states, 10);
		expect(result).toEqual(['c0', 'c1']);
		expect(result).not.toContain('gone');
	});

	it('does not mutate its inputs', () => {
		const lib = library(3);
		const states = [state('c1', 0, 1)];
		const libCopy = structuredClone(lib);
		const statesCopy = structuredClone(states);
		orderRadioPlaylist(lib, states, 10);
		expect(lib).toEqual(libCopy);
		expect(states).toEqual(statesCopy);
	});
});
