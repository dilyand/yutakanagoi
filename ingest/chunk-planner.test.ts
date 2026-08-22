import { describe, expect, it } from 'vitest';
import {
	planChunks,
	enforceMonotonicWindows,
	MAX_MS,
	MIN_MS,
	TARGET_MS,
	PRE_ATTACK_MS,
	TAIL_MS,
	type WhisperSegment,
	type SilenceWindow
} from './chunk-planner.ts';

// Every synthetic case below gives each intended clause its own whisper
// segment, tightly matched to that clause's own timing — this makes the
// proportional-position boundary estimate land very close to the segment's
// own span regardless of exact character counts, the same way a real
// per-sentence ASR segment would. Silence windows sit at the gaps between
// segments.

describe('planChunks — basic sentence-boundary detection + duration-target merge', () => {
	it('merges short sentences toward the target and applies pre-attack/tail buffers at the surviving boundary', () => {
		const transcript = 'おはよう。今日はとてもいい天気ですね。公園まで散歩に行きました。';
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 0, endMs: 3000, text: 'おはよう' },
			{ startMs: 3500, endMs: 8000, text: '今日はとてもいい天気ですね' },
			{ startMs: 8500, endMs: 14000, text: '公園まで散歩に行きました' }
		];
		const silences: SilenceWindow[] = [
			{ startMs: 3100, endMs: 3400 },
			{ startMs: 8100, endMs: 8400 }
		];

		const chunks = planChunks({ transcript, durationMs: 14000, whisperSegments, silences });

		expect(chunks).toHaveLength(2);

		// First two sentences merge (combined 8100ms doesn't exceed MAX_MS,
		// and the accumulator was still under TARGET_MS when the merge
		// decision was made) — first chunk never gets a start adjustment
		// (nothing precedes it), but does get the tail extension into the
		// following silence window.
		expect(chunks[0].startMs).toBe(0);
		expect(chunks[0].durationMs).toBe(8100 + TAIL_MS);
		expect(chunks[0].transcript).toBe('おはよう。今日はとてもいい天気ですね。');

		// Third sentence stands alone (adding it would have pushed the
		// accumulator, already over target, past... no — combined would
		// still fit under MAX_MS, but the accumulator had already reached
		// TARGET_MS and the third sentence isn't itself tiny, so the merge
		// rule stops pulling). Gets the pre-attack pullback at its start,
		// no tail adjustment at the recording's own end.
		expect(chunks[1].startMs).toBe(8400 - PRE_ATTACK_MS);
		expect(chunks[1].durationMs).toBe(14000 - (8400 - PRE_ATTACK_MS));
		expect(chunks[1].transcript).toBe('公園まで散歩に行きました。');
	});

	it("never adjusts the very first chunk's start backward, even with a silence window near time 0", () => {
		const transcript = 'すぐに始まります。それから終わります。';
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 100, endMs: 4000, text: 'すぐに始まります' },
			{ startMs: 4500, endMs: 9000, text: 'それから終わります' }
		];
		const silences: SilenceWindow[] = [
			{ startMs: 0, endMs: 90 }, // near the very start — must never pull chunk 0's start negative or swallow its leading word
			{ startMs: 4100, endMs: 4400 }
		];

		const chunks = planChunks({ transcript, durationMs: 9000, whisperSegments, silences });

		expect(chunks[0].startMs).toBe(0);
	});

	it("never extends the very last chunk's end past the recording, even with a silence window near the end", () => {
		const transcript = 'すぐに始まります。それから終わります。';
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 0, endMs: 4000, text: 'すぐに始まります' },
			{ startMs: 4500, endMs: 8900, text: 'それから終わります' }
		];
		const silences: SilenceWindow[] = [
			{ startMs: 4100, endMs: 4400 },
			{ startMs: 8900, endMs: 9000 }
		];

		const chunks = planChunks({ transcript, durationMs: 9000, whisperSegments, silences });

		expect(chunks[chunks.length - 1].durationMs).toBeGreaterThan(0);
		const last = chunks[chunks.length - 1];
		expect(last.startMs + last.durationMs).toBeLessThanOrEqual(9000);
	});
});

describe('planChunks — discourse-connector merge (だから-chain regression)', () => {
	it('force-merges across だから/でも even though a real pause exists at every boundary, regardless of length', () => {
		// Mirrors the real だから/でも chain that ran to ~25s under a strict
		// merge rule — here the four linked clauses stay one fragment
		// through phase B even though real silences sit at all three
		// internal boundaries, which is what makes it exceed MAX_MS and
		// require phase D's comma-split fallback below.
		const transcript =
			'今日は早く起きました。だから朝ごはんを、ゆっくり食べました。でも時間がなくなりました。だから走って駅まで行きました。';
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 0, endMs: 4000, text: '今日は早く起きました' },
			{ startMs: 4300, endMs: 7000, text: 'だから朝ごはんを' },
			{ startMs: 7300, endMs: 11000, text: 'ゆっくり食べました' },
			{ startMs: 11300, endMs: 16000, text: 'でも時間がなくなりました' },
			{ startMs: 16300, endMs: 21000, text: 'だから走って駅まで行きました' }
		];
		const silences: SilenceWindow[] = [
			{ startMs: 4000, endMs: 4300 }, // sentence boundary — must NOT survive as a cut
			{ startMs: 7000, endMs: 7300 }, // comma inside the chain — the only real cut opportunity once forced together
			{ startMs: 11000, endMs: 11300 }, // sentence boundary — must NOT survive as a cut
			{ startMs: 16000, endMs: 16300 } // sentence boundary — must NOT survive as a cut
		];

		const chunks = planChunks({ transcript, durationMs: 21000, whisperSegments, silences });

		// None of the three sentence-final marks inside the chain survive as
		// a chunk boundary — only the comma does.
		for (const chunk of chunks) {
			expect(chunk.durationMs).toBeLessThanOrEqual(MAX_MS);
		}
		const joined = chunks.map((c) => c.transcript).join('');
		expect(joined.replace(/\s/g, '')).toBe(transcript.replace(/\s/g, ''));
		// The chain must have been split somewhere (it's 21s of forced-
		// together content, well over MAX_MS as one piece) — but not at any
		// of the three period boundaries inside it.
		expect(chunks.some((c) => c.transcript.includes('だから朝ごはんを'))).toBe(true);
		expect(chunks.every((c) => !c.transcript.startsWith('でも'))).toBe(true);
		expect(chunks.every((c) => !c.transcript.startsWith('だから走って'))).toBe(true);
	});
});

describe('planChunks — comma-split of an over-long sentence, then re-merge toward target', () => {
	it('splits at real commas and pulls a too-small trailing piece back in past target rather than stranding it', () => {
		// A single sentence with no internal 。 (so phase A gives it nothing
		// to cut on) whose own span already exceeds MAX_MS. Comma-splitting
		// it produces three pieces (9000ms/4000ms/2000ms); the last is below
		// MIN_MS on its own, so the re-merge pulls it into the middle piece
		// even though the middle piece alone is already under target size —
		// specifically exercising the "a tiny trailing fragment forces a
		// merge past TARGET_MS" rule.
		const preamble = 'だから朝早く起きて走ってきたんだけど。';
		const longSentence =
			'もう起きた時になんかすごい疲れてて眠くて、あんまり走る気がしなかったんだけど、ちょっとだけ走ってきた。';
		const transcript = preamble + longSentence;

		const whisperSegments: WhisperSegment[] = [
			{ startMs: 0, endMs: 3900, text: preamble.slice(0, -1) },
			{ startMs: 4200, endMs: 13200, text: 'もう起きた時になんかすごい疲れてて眠くて' },
			{ startMs: 13500, endMs: 17500, text: 'あんまり走る気がしなかったんだけど' },
			{ startMs: 17800, endMs: 19800, text: 'ちょっとだけ走ってきた' }
		];
		const silences: SilenceWindow[] = [
			{ startMs: 3900, endMs: 4200 }, // period after the preamble
			{ startMs: 13200, endMs: 13500 }, // first comma
			{ startMs: 17500, endMs: 17800 } // second comma
		];

		const chunks = planChunks({ transcript, durationMs: 19800, whisperSegments, silences });

		// The preamble stays its own chunk — it never starts with a
		// discourse connector from anything preceding it (nothing does),
		// even though its own text happens to start with だから.
		expect(chunks[0].transcript).toBe(preamble);

		// Everything after the preamble is fully covered, ends up ≤ MAX_MS
		// per chunk, and the last (tiny, 2000ms) piece is not left standing
		// alone — i.e. there is no output chunk whose content is *only*
		// 'ちょっとだけ走ってきた。'.
		const rest = chunks.slice(1);
		for (const chunk of rest) {
			expect(chunk.durationMs).toBeLessThanOrEqual(MAX_MS);
		}
		expect(rest.some((c) => c.transcript === 'ちょっとだけ走ってきた。')).toBe(false);
		expect(rest[rest.length - 1].transcript.endsWith('ちょっとだけ走ってきた。')).toBe(true);

		const joined = chunks.map((c) => c.transcript).join('');
		expect(joined.replace(/\s/g, '')).toBe(transcript.replace(/\s/g, ''));
	});

	it('accepts an over-length chunk rather than fabricate a cut, when no comma has a real silence nearby', () => {
		const transcript = 'とても長い一つの文章がずっと続いていてどこにも読点がありません。';
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 0, endMs: 16000, text: transcript.slice(0, -1) }
		];
		const silences: SilenceWindow[] = []; // nothing to cut on anywhere

		const chunks = planChunks({ transcript, durationMs: 16000, whisperSegments, silences });

		expect(chunks).toHaveLength(1);
		expect(chunks[0].durationMs).toBeGreaterThan(MAX_MS);
		expect(chunks[0].transcript).toBe(transcript);
	});
});

describe('enforceMonotonicWindows (code review regression)', () => {
	// findBestSilence resolves each candidate boundary independently, so two
	// nearby candidates can land on the same real silence window (or, more
	// rarely, on out-of-order ones). Unfiltered, the caller's cursor-based
	// loop then builds a fragment whose end is before its start. Tested
	// directly against enforceMonotonicWindows rather than through
	// planChunks's full pipeline: end-to-end, greedyMergeToward's forced
	// pull-in of anything under MIN_MS (including a negative-duration
	// fragment, which trivially satisfies "< MIN_MS") silently absorbs the
	// broken fragment into its neighbor most of the time, so a black-box
	// planChunks test can pass even when this filter is missing — the
	// absorption doesn't crash or produce an obviously malformed chunk, it
	// silently pulls the wrong span of transcript text into a chunk whose
	// actual audio doesn't contain it, which nothing downstream (verify.ts
	// checks audio content, not transcript-to-audio alignment) would catch.
	it('drops a later candidate whose window is identical to an earlier accepted one', () => {
		const window = { startMs: 1300, endMs: 1700 };
		const cuts = [
			{ localCharIndex: 9, window },
			{ localCharIndex: 16, window }
		];
		expect(enforceMonotonicWindows(cuts)).toEqual([{ localCharIndex: 9, window }]);
	});

	it('drops a later candidate whose window overlaps (but is not identical to) an earlier accepted one', () => {
		const cuts = [
			{ localCharIndex: 5, window: { startMs: 1000, endMs: 1500 } },
			{ localCharIndex: 12, window: { startMs: 1200, endMs: 1800 } } // starts before the first ends
		];
		expect(enforceMonotonicWindows(cuts)).toEqual([cuts[0]]);
	});

	it('keeps every candidate when windows are already strictly increasing and non-overlapping', () => {
		const cuts = [
			{ localCharIndex: 5, window: { startMs: 1000, endMs: 1200 } },
			{ localCharIndex: 12, window: { startMs: 2000, endMs: 2200 } },
			{ localCharIndex: 20, window: { startMs: 3000, endMs: 3200 } }
		];
		expect(enforceMonotonicWindows(cuts)).toEqual(cuts);
	});

	it('accepts a window that starts exactly where the previous one ended (touching, not overlapping)', () => {
		const cuts = [
			{ localCharIndex: 5, window: { startMs: 1000, endMs: 1200 } },
			{ localCharIndex: 12, window: { startMs: 1200, endMs: 1400 } }
		];
		expect(enforceMonotonicWindows(cuts)).toEqual(cuts);
	});
});

describe('planChunks — coverage', () => {
	it('produces contiguous, non-overlapping chunks whose transcripts concatenate back to the source, for varied inputs', () => {
		const transcript = '一文目です。二文目です。三文目です。四文目です。';
		const segLen = 3000;
		const gap = 300;
		let t = 0;
		const sentences = ['一文目です', '二文目です', '三文目です', '四文目です'];
		const whisperSegments: WhisperSegment[] = [];
		const silences: SilenceWindow[] = [];
		for (const [i, s] of sentences.entries()) {
			whisperSegments.push({ startMs: t, endMs: t + segLen, text: s });
			t += segLen;
			if (i < sentences.length - 1) {
				silences.push({ startMs: t, endMs: t + gap });
				t += gap;
			}
		}

		const chunks = planChunks({ transcript, durationMs: t, whisperSegments, silences });

		expect(chunks.length).toBeGreaterThan(0);
		for (let i = 1; i < chunks.length; i++) {
			expect(chunks[i].startMs).toBeGreaterThanOrEqual(
				chunks[i - 1].startMs + chunks[i - 1].durationMs
			);
		}
		const joined = chunks.map((c) => c.transcript).join('');
		expect(joined.replace(/\s/g, '')).toBe(transcript.replace(/\s/g, ''));
	});

	it('exports the tuning constants used elsewhere in the ingest pipeline', () => {
		expect(TARGET_MS).toBeGreaterThan(0);
		expect(MAX_MS).toBeGreaterThan(TARGET_MS);
		expect(MIN_MS).toBeLessThan(TARGET_MS);
		expect(PRE_ATTACK_MS).toBeGreaterThan(0);
		expect(TAIL_MS).toBeGreaterThan(0);
	});
});
