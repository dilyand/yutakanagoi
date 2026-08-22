import { describe, expect, it } from 'vitest';
import { verifyCoverage } from './verify.ts';

// verifyChunk itself needs real audio files (ffmpeg content-match, RMS
// probes) — exercised via real fixtures through ingest:cut, not unit
// tests here. verifyCoverage and verifyDistinct are pure and testable
// directly.

describe('verifyCoverage (code review regression)', () => {
	it('flags chunks given out of chronological order instead of silently accepting them', () => {
		// An earlier version sorted a copy of `chunks` before validating,
		// which defeats the point of this check: if the planner itself ever
		// returns chunks out of order (the actual regression this exists to
		// catch), the sorted copy passes even though cut.ts still writes
		// chunks.json's indices and transcripts in the original, wrong order.
		const chunks = [
			{ startMs: 2000, durationMs: 1000 }, // out of order: should be second
			{ startMs: 0, durationMs: 1000 }
		];
		const result = verifyCoverage(chunks, 3000);
		expect(result.ok).toBe(false);
	});

	it('passes chunks already given in chronological, non-overlapping order', () => {
		const chunks = [
			{ startMs: 0, durationMs: 1000 },
			{ startMs: 1000, durationMs: 1000 },
			{ startMs: 2000, durationMs: 1000 }
		];
		const result = verifyCoverage(chunks, 3000);
		expect(result.ok).toBe(true);
	});
});
