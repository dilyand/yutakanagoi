import { describe, expect, it } from 'vitest';
import {
	DEFAULT_RADIO_REPEATS,
	MAX_RADIO_REPEATS,
	MIN_RADIO_REPEATS,
	startPosition,
	clampRepeats,
	nextPosition,
	type RadioPosition
} from './radio-sequencer';

/** Steps from the start, returning every position visited (including the start) and each cycleEnded flag. */
function walk(playlistLength: number, repeats: number, steps: number) {
	const visited: RadioPosition[] = [startPosition()];
	const ended: boolean[] = [];
	let pos = startPosition();
	for (let i = 0; i < steps; i++) {
		const next = nextPosition(pos, playlistLength, repeats);
		ended.push(next.cycleEnded);
		pos = next.pos;
		visited.push(pos);
	}
	return { visited, ended };
}

describe('DEFAULT_RADIO_REPEATS', () => {
	it('is 3', () => {
		expect(DEFAULT_RADIO_REPEATS).toBe(3);
	});
});

describe('nextPosition', () => {
	it('with repeats 1, moves to the next clip after every play', () => {
		const { visited } = walk(3, 1, 2);
		expect(visited).toEqual([
			{ index: 0, play: 1 },
			{ index: 1, play: 1 },
			{ index: 2, play: 1 }
		]);
	});

	it('with repeats 2, plays each clip twice before moving on', () => {
		const { visited } = walk(2, 2, 3);
		expect(visited).toEqual([
			{ index: 0, play: 1 },
			{ index: 0, play: 2 },
			{ index: 1, play: 1 },
			{ index: 1, play: 2 }
		]);
	});

	it('with repeats 3 (the default), plays each clip three times', () => {
		const { visited } = walk(2, DEFAULT_RADIO_REPEATS, 5);
		expect(visited.map((p) => `${p.index}.${p.play}`)).toEqual([
			'0.1',
			'0.2',
			'0.3',
			'1.1',
			'1.2',
			'1.3'
		]);
	});

	it('reports cycleEnded only on the finish of the very last play of the last clip, and wraps to the start', () => {
		const { visited, ended } = walk(2, 2, 4);
		// plays: 0.1 -> 0.2 -> 1.1 -> 1.2 -> (wrap)
		expect(ended).toEqual([false, false, false, true]);
		expect(visited[4]).toEqual(startPosition());
	});

	it('keeps looping: five full cycles in a row each end exactly once', () => {
		const { ended } = walk(3, 2, 6 * 5);
		expect(ended.filter(Boolean)).toHaveLength(5);
		expect(ended.at(-1)).toBe(true);
	});

	it('handles a one-clip playlist: repeats, then every pass ends the cycle', () => {
		const { visited, ended } = walk(1, 3, 6);
		expect(visited.map((p) => `${p.index}.${p.play}`)).toEqual([
			'0.1',
			'0.2',
			'0.3',
			'0.1',
			'0.2',
			'0.3',
			'0.1'
		]);
		expect(ended).toEqual([false, false, true, false, false, true]);
	});

	it('takes a lowered repeat count into effect immediately: a clip already heard enough times just advances', () => {
		// On play 3 of 5 repeats the user drops repeats to 2.
		const next = nextPosition({ index: 0, play: 3 }, 4, 2);
		expect(next).toEqual({ pos: { index: 1, play: 1 }, cycleEnded: false });
	});

	it('takes a lowered repeat count into effect on the last clip too, ending the cycle', () => {
		const next = nextPosition({ index: 3, play: 3 }, 4, 1);
		expect(next).toEqual({ pos: startPosition(), cycleEnded: true });
	});

	it('extends the current clip when repeats is raised mid-clip', () => {
		const next = nextPosition({ index: 0, play: 2 }, 4, 5);
		expect(next).toEqual({ pos: { index: 0, play: 3 }, cycleEnded: false });
	});

	it('treats an empty playlist as the end of a cycle, at the start position', () => {
		expect(nextPosition(startPosition(), 0, 3)).toEqual({
			pos: startPosition(),
			cycleEnded: true
		});
	});

	it('treats a position past the end of a shrunken playlist as the end of a cycle', () => {
		// e.g. radio was on clip 4 of 5, and flagging shrank the list to 3.
		expect(nextPosition({ index: 3, play: 1 }, 3, 3)).toEqual({
			pos: startPosition(),
			cycleEnded: true
		});
	});

	it('does not mutate the position it was given, in any of its three branches', () => {
		const nextPlay = { index: 0, play: 1 };
		nextPosition(nextPlay, 3, 3);
		expect(nextPlay).toEqual({ index: 0, play: 1 });

		const nextClip = { index: 0, play: 3 };
		nextPosition(nextClip, 3, 3);
		expect(nextClip).toEqual({ index: 0, play: 3 });

		const wrap = { index: 2, play: 3 };
		nextPosition(wrap, 3, 3);
		expect(wrap).toEqual({ index: 2, play: 3 });
	});

	it('hands out a fresh start position each time, so callers can safely mutate it', () => {
		const wrapped = nextPosition({ index: 0, play: 1 }, 1, 1).pos;
		wrapped.index = 99;
		expect(nextPosition({ index: 0, play: 1 }, 1, 1).pos).toEqual({ index: 0, play: 1 });
		expect(startPosition()).not.toBe(startPosition());
	});
});

describe('clampRepeats', () => {
	it('passes through whole numbers in range', () => {
		for (let n = MIN_RADIO_REPEATS; n <= MAX_RADIO_REPEATS; n++) {
			expect(clampRepeats(n)).toBe(n);
		}
	});

	it('clamps below the minimum and above the maximum', () => {
		expect(clampRepeats(0)).toBe(MIN_RADIO_REPEATS);
		expect(clampRepeats(-5)).toBe(MIN_RADIO_REPEATS);
		expect(clampRepeats(11)).toBe(MAX_RADIO_REPEATS);
		expect(clampRepeats(1000)).toBe(MAX_RADIO_REPEATS);
	});

	it('rounds fractions to a whole number', () => {
		expect(clampRepeats(2.4)).toBe(2);
		expect(clampRepeats(2.6)).toBe(3);
	});

	it('falls back to the default for NaN, and clamps the infinities', () => {
		expect(clampRepeats(NaN)).toBe(DEFAULT_RADIO_REPEATS);
		expect(clampRepeats(Infinity)).toBe(MAX_RADIO_REPEATS);
		expect(clampRepeats(-Infinity)).toBe(MIN_RADIO_REPEATS);
	});

	it('keeps the default itself within range', () => {
		expect(clampRepeats(DEFAULT_RADIO_REPEATS)).toBe(DEFAULT_RADIO_REPEATS);
	});
});
