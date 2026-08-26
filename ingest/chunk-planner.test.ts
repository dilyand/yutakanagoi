import { describe, expect, it } from 'vitest';
import {
	splitIntoSentenceUnits,
	locateChunks,
	enforceMonotonicWindows,
	jointBoundary,
	findCandidates,
	findBestSilence,
	normalizeMarkWidth,
	PRE_ATTACK_MS,
	TAIL_MS,
	type WhisperSegment,
	type SilenceWindow,
	type ChunkPlanEntry
} from './chunk-planner.ts';

describe('normalizeMarkWidth (real-recording regression)', () => {
	it('maps half-width ?/!/.,  to their full-width Japanese equivalents', () => {
		expect(normalizeMarkWidth('元気?すごい!です.あと,')).toBe('元気？すごい！です。あと、');
	});

	it('leaves already-full-width marks and ordinary text untouched', () => {
		expect(normalizeMarkWidth('おはよう。元気？すごい！')).toBe('おはよう。元気？すごい！');
	});

	it('is a 1:1 substitution, never changing the character count', () => {
		const text = '元気?すごい!です.あと,ふつうのぶん';
		expect(Array.from(normalizeMarkWidth(text)).length).toBe(Array.from(text).length);
	});

	it('leaves a "."/"," flanked by digits alone — a decimal point or thousands separator, not a Japanese mark', () => {
		// Found in code review 2026-08-24: blindly converting every
		// half-width "."/"," corrupted "3.5キロ" into "3。5キロ" (splitting it
		// into separate sentence units) and "1,000円" into "1、000円". "?"/"!"
		// don't need this care — they have no legitimate non-terminal use in
		// this content.
		expect(normalizeMarkWidth('3.5キロ走った。')).toBe('3.5キロ走った。');
		expect(normalizeMarkWidth('1,000円でした。')).toBe('1,000円でした。');
	});

	it('also recognizes full-width digits as flanking a "."/","', () => {
		// Found in code review 2026-08-24: an ASCII-only digit check still
		// corrupted "３.５キロ" (full-width digits, half-width mark — a
		// realistic mixed-width IME slip) into "３。５キロ".
		expect(normalizeMarkWidth('３.５キロ走った。')).toBe('３.５キロ走った。');
		expect(normalizeMarkWidth('１,０００円でした。')).toBe('１,０００円でした。');
	});

	it('still converts a "."/"," that is not flanked by digits on both sides', () => {
		expect(normalizeMarkWidth('今日は晴れです.明日は雨かな,どうかな')).toBe(
			'今日は晴れです。明日は雨かな、どうかな'
		);
		// Digit on only one side (end of a number, not between two digits).
		expect(normalizeMarkWidth('15分だけ.')).toBe('15分だけ。');
	});
});

describe('splitIntoSentenceUnits', () => {
	it('splits purely on sentence-final marks, no audio input at all', () => {
		// なんと！ ends its own atomic unit here (！ is itself a
		// sentence-final mark) — grouping it back with そして and/or the
		// sentence that follows is exactly the kind of meaning-based
		// decision that now happens by hand, not automatically here.
		const transcript =
			'最近、ランニングを始めたでしょう?そして、なんと!新しいニューシューズを買いました。';
		const units = splitIntoSentenceUnits(transcript);
		expect(units).toEqual([
			'最近、ランニングを始めたでしょう？',
			'そして、なんと！',
			'新しいニューシューズを買いました。'
		]);
	});

	it('normalizes half-width marks before splitting — a half-width "?" produces its own unit boundary, same as the full-width form', () => {
		// Real recovered-audio case (2026-08-23): before width-normalization,
		// a half-width "?" here was invisible to the splitter entirely, so
		// "大丈夫?ノロウイルスは...大変だ。" never had a chance to become its
		// own atomic unit in the first place.
		const transcript = 'こんにちは、ディリャン。大丈夫?ノロウイルスはお腹が痛かったり大変だ。';
		const units = splitIntoSentenceUnits(transcript);
		expect(units).toEqual([
			'こんにちは、ディリャン。',
			'大丈夫？',
			'ノロウイルスはお腹が痛かったり大変だ。'
		]);
	});

	it('every unit concatenates back to the exact (width-normalized) input, with no text lost or reordered', () => {
		const transcript = '一文目です。二文目です?三文目です!四文目です。';
		const units = splitIntoSentenceUnits(transcript);
		expect(units.join('')).toBe(normalizeMarkWidth(transcript));
	});

	it('a transcript with no sentence-final mark at all comes back as one unit', () => {
		const transcript = 'これはとても長い文章がずっと続いていてどこにも句点がありません';
		expect(splitIntoSentenceUnits(transcript)).toEqual([transcript]);
	});
});

describe('locateChunks', () => {
	it('estimates a boundary as the gap between neighboring characters, not the midpoint of the character after it', () => {
		// Found in code review 2026-08-24: when the transcript's own
		// non-punctuation character count exactly matches the charTimings
		// spine length, the old estimateTimeMs rounded a boundary after k
		// characters to spine index k exactly — the MIDPOINT of the
		// character *after* the boundary, not the gap after the character
		// before it. That's a systematic late bias, not occasional rounding
		// noise. Here charTimings has one entry per character (あ,い,う,え at
		// 50/150/250/350ms), and the boundary falls after "あい" (2 of 4
		// chars) — the true gap sits at the midpoint of い(150) and う(250),
		// i.e. 200ms. A "trap" pause at 260-280ms sits close to the OLD
		// biased estimate (250, う's own midpoint) and would have won under
		// it; the real gap position (190-210ms) must win instead.
		const transcript = 'あい。うえ。';
		const plan: ChunkPlanEntry[] = [{ text: 'あい。' }, { text: 'うえ。' }];
		const charTimings: WhisperSegment[] = [
			{ startMs: 0, endMs: 100, text: 'あ' },
			{ startMs: 100, endMs: 200, text: 'い' },
			{ startMs: 200, endMs: 300, text: 'う' },
			{ startMs: 300, endMs: 400, text: 'え' }
		];
		const silences: SilenceWindow[] = [
			{ startMs: 190, endMs: 210 }, // the true gap — must win
			{ startMs: 260, endMs: 280 } // the trap the old bias would have picked
		];

		const result = locateChunks(plan, transcript, charTimings, [], silences, 400);

		expect(result.ok).toBe(true);
		expect(result.chunks[0].transcript).toBe('あい。');
		// Boundary resolved to the true-gap window (190-210), not the trap
		// (260-280) — chunk 0 ends within the true window's jointBoundary
		// range, nowhere near the trap window's.
		expect(result.chunks[0].startMs + result.chunks[0].durationMs).toBeLessThan(230);
	});

	it('locates a real-recording plan correctly, including a boundary a human grouped that the old automatic planner never could', () => {
		// Real recording (hellotalk-260813-1454-1, 2026-08-23): a human
		// reading this transcript for meaning would group "大丈夫？" with the
		// greeting before it, not with the (unrelated-in-tone) illness
		// description after it — chunk_plan.json here reflects exactly that
		// grouping decision. locateChunks' only job is finding where the
		// resulting two chunks fall in the real audio.
		const transcript =
			'こんにちは、ディリャン。大丈夫？ノロウイルスはお腹が痛かったり、吐き気があったり大変だよね。大変だ。消化にいいものを食べて、よく休んで。';
		const plan: ChunkPlanEntry[] = [
			{ text: 'こんにちは、ディリャン。大丈夫？' },
			{ text: 'ノロウイルスはお腹が痛かったり、吐き気があったり大変だよね。大変だ。' },
			{ text: '消化にいいものを食べて、よく休んで。' }
		];
		const charTimings: WhisperSegment[] = [];
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 0, endMs: 9240, text: 'こんにちはだいりゃん 大丈夫' },
			{ startMs: 9240, endMs: 14120, text: 'ノロウイルスは お腹が痛かったり' },
			{ startMs: 14120, endMs: 17920, text: '吐き気があったり大変だよねー' },
			{ startMs: 18480, endMs: 21000, text: '大変だ' },
			{ startMs: 21280, endMs: 26040, text: '消化にいいものを食べて よく休んで' }
		];
		const silences: SilenceWindow[] = [
			{ startMs: 0, endMs: 4078 },
			{ startMs: 5383, endMs: 7211 },
			{ startMs: 7978, endMs: 9345 },
			{ startMs: 10579, endMs: 11566 },
			{ startMs: 12574, endMs: 12750 },
			{ startMs: 13114, endMs: 14073 },
			{ startMs: 16063, endMs: 18505 },
			{ startMs: 19061, endMs: 21490 }
		];

		const result = locateChunks(plan, transcript, charTimings, whisperSegments, silences, 28308);

		expect(result.ok).toBe(true);
		expect(result.chunks.map((c) => c.transcript)).toEqual(plan.map((p) => p.text));
		expect(result.chunks[0].startMs).toBe(0);
		for (let i = 1; i < result.chunks.length; i++) {
			expect(result.chunks[i].startMs).toBeGreaterThanOrEqual(
				result.chunks[i - 1].startMs + result.chunks[i - 1].durationMs
			);
		}
	});

	it('prefers the fine charTimings spine over whisperSegments when both are given', () => {
		// A deliberately misleading whisperSegments span (as if the coarse
		// segment badly mistimed this sentence) — charTimings gives the real
		// per-character positions, which locateChunks should use instead.
		const transcript = 'おはよう。今日はいい天気です。';
		const plan: ChunkPlanEntry[] = [{ text: 'おはよう。' }, { text: '今日はいい天気です。' }];
		const charTimings: WhisperSegment[] = [
			{ startMs: 0, endMs: 3000, text: 'おはよう' },
			{ startMs: 3500, endMs: 8000, text: '今日はいい天気です' }
		];
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 0, endMs: 100, text: 'おはよう今日はいい天気です' } // badly mistimed
		];
		const silences: SilenceWindow[] = [{ startMs: 3100, endMs: 3400 }];

		const result = locateChunks(plan, transcript, charTimings, whisperSegments, silences, 8000);

		expect(result.ok).toBe(true);
		expect(result.chunks[0].durationMs).toBe(3100 + TAIL_MS);
	});

	it('falls back to whisperSegments for the whole recording when charTimings is nonempty but leaves a real gap', () => {
		// Found in code review 2026-08-24: a nonempty-but-partial charTimings
		// result (whisper's -ml 1 pass can legitimately come back sparse or
		// missing for a hard stretch — see transcribeWavCharTimings' own doc
		// comment) was being trusted for the ENTIRE recording just because it
		// wasn't empty. Here charTimings only covers "おはよう" (0-1000ms) and
		// says nothing about the other 7000ms of an 8000ms recording — using
		// it anyway would clamp every later boundary estimate to ~1000ms
		// (the last spine entry), missing the real pause at ~3250ms by more
		// than the tight char-timing margin allows. Must fall back to
		// whisperSegments (correctly timed here) for the whole recording,
		// not just the uncovered tail.
		const transcript = 'おはよう。今日はいい天気です。';
		const plan: ChunkPlanEntry[] = [{ text: 'おはよう。' }, { text: '今日はいい天気です。' }];
		const charTimings: WhisperSegment[] = [
			{ startMs: 0, endMs: 250, text: 'お' },
			{ startMs: 250, endMs: 500, text: 'は' },
			{ startMs: 500, endMs: 750, text: 'よ' },
			{ startMs: 750, endMs: 1000, text: 'う' }
			// nothing from 1000ms to the recording's 8000ms end
		];
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 0, endMs: 3000, text: 'おはよう' },
			{ startMs: 3500, endMs: 8000, text: '今日はいい天気です' }
		];
		const silences: SilenceWindow[] = [{ startMs: 3100, endMs: 3400 }];

		const result = locateChunks(plan, transcript, charTimings, whisperSegments, silences, 8000);

		expect(result.ok).toBe(true);
		expect(result.chunks[0].durationMs).toBe(3100 + TAIL_MS);
	});

	it('does not treat genuine leading silence as insufficient charTimings coverage', () => {
		// Real recording (hellotalk-260808-1817, 2026-08-24): a first version
		// of the coverage check above flagged ANY head/tail/internal gap over
		// MAX_CHAR_TIMING_GAP_MS as "insufficient", with no way to tell real
		// silence apart from actually-missing data — which wrongly discarded
		// charTimings for this exact recording, which has a confirmed,
		// fully-silent 3.9s opening (RMS-verified at -120dB throughout) before
		// speech starts. charTimings correctly has nothing to time before
		// 3910ms — that's an accurate absence, not missing data — while
		// whisperSegments' own (coarser, less reliable) first segment
		// wrongly claims speech starts at 0ms. The fix must still prefer
		// charTimings here specifically because a real silences entry
		// explains the gap.
		const transcript = 'おはよう。今日はいい天気です。';
		const plan: ChunkPlanEntry[] = [{ text: 'おはよう。' }, { text: '今日はいい天気です。' }];
		const charTimings: WhisperSegment[] = [
			{ startMs: 3910, endMs: 4200, text: 'お' },
			{ startMs: 4200, endMs: 4450, text: 'は' },
			{ startMs: 4450, endMs: 4700, text: 'よ' },
			{ startMs: 4700, endMs: 4950, text: 'う' },
			{ startMs: 5450, endMs: 5950, text: '今日' },
			{ startMs: 5950, endMs: 6150, text: 'は' },
			{ startMs: 6150, endMs: 6350, text: 'いい' },
			{ startMs: 6350, endMs: 6650, text: '天気' },
			{ startMs: 6650, endMs: 6900, text: 'です' }
		];
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 0, endMs: 4950, text: 'おはよう' }, // wrongly claims speech starts at 0
			{ startMs: 5450, endMs: 6900, text: '今日はいい天気です' }
		];
		const silences: SilenceWindow[] = [
			{ startMs: 0, endMs: 3910 }, // the genuine lead-in — explains the head gap
			{ startMs: 5050, endMs: 5350 } // the real pause between the two sentences
		];

		const result = locateChunks(plan, transcript, charTimings, whisperSegments, silences, 6900);

		expect(result.ok).toBe(true);
		// Resolves to the real pause (5050-5350) that charTimings' own
		// precise spine points to — not whisperSegments' misleadingly wide
		// first segment, which this test would otherwise fall back to.
		expect(result.chunks[0].startMs + result.chunks[0].durationMs).toBeLessThan(5450);
	});

	it('fails with a clear, actionable message when a decided boundary has no real pause nearby, instead of silently forcing a bad cut', () => {
		const transcript = 'おはよう。今日はいい天気です。';
		const plan: ChunkPlanEntry[] = [{ text: 'おはよう。' }, { text: '今日はいい天気です。' }];
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 0, endMs: 3000, text: 'おはよう' },
			{ startMs: 3500, endMs: 8000, text: '今日はいい天気です' }
		];
		const silences: SilenceWindow[] = []; // no pause anywhere

		const result = locateChunks(plan, transcript, [], whisperSegments, silences, 8000);

		expect(result.ok).toBe(false);
		expect(result.chunks).toEqual([]);
		expect(result.failures).toHaveLength(1);
		expect(result.failures[0]).toMatch(/merge these two chunks in chunk_plan\.json/);
	});

	it('fails when planned chunk texts do not reconstruct the transcript exactly', () => {
		const transcript = 'おはよう。今日はいい天気です。';
		const plan: ChunkPlanEntry[] = [{ text: 'おはよう。' }, { text: '今日は素晴らしい天気です。' }]; // hand-edited wording
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 0, endMs: 3000, text: 'おはよう' },
			{ startMs: 3500, endMs: 8000, text: '今日はいい天気です' }
		];

		const result = locateChunks(plan, transcript, [], whisperSegments, [], 8000);

		expect(result.ok).toBe(false);
		expect(result.chunks).toEqual([]);
		expect(result.failures[0]).toMatch(/do not reconstruct/);
	});

	it('accepts a plan entry that differs from the raw transcript only by mark width, rather than rejecting valid scaffold output', () => {
		// Found in code review 2026-08-24: this reconstruction check compares
		// width-normalized text on both sides (same as splitIntoSentenceUnits
		// already does when producing chunk_plan.json's scaffold in the first
		// place), so a raw transcript with a half-width mark and an untouched
		// generated entry (already full-width) are expected to differ by
		// exactly this — that must NOT be treated as a grouping mistake.
		const transcript = 'おはよう。今日はいい天気です?'; // half-width "?" in the raw field
		const plan: ChunkPlanEntry[] = [
			{ text: 'おはよう。今日はいい天気です？' } // full-width, as splitIntoSentenceUnits would emit
		];
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 0, endMs: 8000, text: 'おはよう今日はいい天気です' }
		];

		const result = locateChunks(plan, transcript, [], whisperSegments, [], 8000);

		expect(result.ok).toBe(true);
		expect(result.chunks[0].transcript).toBe('おはよう。今日はいい天気です？');
	});

	it('fails on zero planned chunks rather than silently producing an empty recording', () => {
		const result = locateChunks([], 'おはよう。', [], [], [], 3000);
		expect(result.ok).toBe(false);
		expect(result.chunks).toEqual([]);
	});

	it('fails on an entry with empty text rather than publishing a zero-duration, transcript-less chunk', () => {
		// Found in code review 2026-08-24: chunk_plan.json is hand-edited —
		// merging two entries can leave the merged-away one behind as
		// { text: "", ... } instead of being deleted. An empty string still
		// concatenates correctly, so the reconstruction check alone wouldn't
		// catch it.
		const transcript = 'おはよう。今日はいい天気です。';
		const plan: ChunkPlanEntry[] = [
			{ text: 'おはよう。' },
			{ text: '' },
			{ text: '今日はいい天気です。' }
		];
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 0, endMs: 3000, text: 'おはよう' },
			{ startMs: 3500, endMs: 8000, text: '今日はいい天気です' }
		];

		const result = locateChunks(plan, transcript, [], whisperSegments, [], 8000);

		expect(result.ok).toBe(false);
		expect(result.chunks).toEqual([]);
		expect(result.failures[0]).toMatch(/empty "text"/);
	});
});

describe('enforceMonotonicWindows (code review regression)', () => {
	// findBestSilence resolves each candidate boundary independently, so two
	// nearby candidates can land on the same real silence window (or, more
	// rarely, on out-of-order ones). Unfiltered, a cursor-based build then
	// produces a fragment whose end is before its start.
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

	it('drops a later candidate whose window starts exactly where the previous one ended (touching, not just overlapping)', () => {
		// A touching pair still builds a [prevEnd, nextStart] = [1200, 1200]
		// zero-duration fragment for whatever transcript text falls between
		// the two cuts — real text silently attached to a neighbor with no
		// audio span behind it once that fragment gets merged. Caught in
		// code review: an earlier version of this fix only rejected a
		// strictly-overlapping (`<`) window, not a touching one.
		const cuts = [
			{ localCharIndex: 5, window: { startMs: 1000, endMs: 1200 } },
			{ localCharIndex: 12, window: { startMs: 1200, endMs: 1400 } }
		];
		expect(enforceMonotonicWindows(cuts)).toEqual([cuts[0]]);
	});
});

describe('jointBoundary (code review regression)', () => {
	// findBestSilence/detectSilences can produce windows as short as
	// DEFAULT_SILENCE_MIN_DURATION_S (150ms), well under the 275ms
	// (PRE_ATTACK_MS + TAIL_MS) both adjustments need in full, so two
	// independently-clamped chunk edges could otherwise cross.

	it('reproduces the original independent-clamp behavior when the window is wide enough for both adjustments', () => {
		const window: SilenceWindow = { startMs: 1000, endMs: 1300 }; // 300ms, > 275ms
		const { chunkEndMs, nextStartMs } = jointBoundary(window);
		expect(chunkEndMs).toBe(1000 + TAIL_MS);
		expect(nextStartMs).toBe(1300 - PRE_ATTACK_MS);
		expect(chunkEndMs).toBeLessThan(nextStartMs); // the original's small gap is preserved
	});

	it('meets at exactly one point, never crossing, for a window narrower than PRE_ATTACK_MS + TAIL_MS (150-274ms)', () => {
		for (const width of [150, 200, 250, 274]) {
			const window: SilenceWindow = { startMs: 1000, endMs: 1000 + width };
			const { chunkEndMs, nextStartMs } = jointBoundary(window);
			expect(chunkEndMs).toBe(nextStartMs);
			expect(chunkEndMs).toBeGreaterThanOrEqual(window.startMs);
			expect(chunkEndMs).toBeLessThanOrEqual(window.endMs);
		}
	});

	it('is continuous at the exact PRE_ATTACK_MS + TAIL_MS threshold', () => {
		const window: SilenceWindow = { startMs: 1000, endMs: 1000 + PRE_ATTACK_MS + TAIL_MS };
		const { chunkEndMs, nextStartMs } = jointBoundary(window);
		expect(chunkEndMs).toBe(nextStartMs);
		expect(chunkEndMs).toBe(1000 + TAIL_MS);
	});

	it('locateChunks end-to-end: two chunks straddling a 200ms internal window never overlap', () => {
		const transcript = 'すぐに始まります。それから終わります。';
		const plan: ChunkPlanEntry[] = [
			{ text: 'すぐに始まります。' },
			{ text: 'それから終わります。' }
		];
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 0, endMs: 8300, text: 'すぐに始まります' },
			{ startMs: 8500, endMs: 16800, text: 'それから終わります' }
		];
		// A 200ms window: narrower than PRE_ATTACK_MS + TAIL_MS (275ms).
		const silences: SilenceWindow[] = [{ startMs: 8300, endMs: 8500 }];

		const result = locateChunks(plan, transcript, [], whisperSegments, silences, 16800);

		expect(result.ok).toBe(true);
		expect(result.chunks).toHaveLength(2);
		expect(result.chunks[0].startMs + result.chunks[0].durationMs).toBeLessThanOrEqual(
			result.chunks[1].startMs
		);
	});
});

describe('findCandidates (code review regression)', () => {
	it('advances a sentence-final boundary past a trailing closing quote, so the quote stays with the sentence it closes', () => {
		// Without the fix, the 。 boundary lands right before 」, orphaning
		// the closing quote into the start of the next chunk's transcript —
		// one chunk ends with an unmatched 「, the next starts with a stray 」.
		const text = '「こんにちは。」次に会いましょう。';
		const candidates = findCandidates(text, new Set(['。', '！', '？']));
		const boundaryChars = candidates.map((c) => Array.from(text.slice(0, c.charIndex)).join(''));
		expect(boundaryChars).toEqual(['「こんにちは。」']);
	});

	it('advances past whitespace after a trailing closing quote too', () => {
		const text = '「そうですね。」 それから帰りました。';
		const candidates = findCandidates(text, new Set(['。', '！', '？']));
		expect(Array.from(text.slice(0, candidates[0].charIndex)).join('')).toBe('「そうですね。」 ');
	});

	it('does not advance past an opening quote that starts the next sentence', () => {
		// 文A。「文B」 — the 「 here belongs to the next sentence, not the one
		// that just ended, so the boundary must stop right after the 。.
		const text = '文A。「文B」';
		const candidates = findCandidates(text, new Set(['。', '！', '？']));
		expect(Array.from(text.slice(0, candidates[0].charIndex)).join('')).toBe('文A。');
	});

	it('treats consecutive sentence-final marks (！？) as a single boundary', () => {
		// Without deferring to the last adjacent mark, "！" and "？" each
		// produce their own candidate — a boundary could then land between
		// them, starting the next chunk's hint text with a stray "？".
		const text = '本当！？次に行きましょう。またね。';
		const candidates = findCandidates(text, new Set(['。', '！', '？']));
		const boundaryChars = candidates.map((c) => Array.from(text.slice(0, c.charIndex)).join(''));
		expect(boundaryChars).toEqual(['本当！？', '本当！？次に行きましょう。']);
	});

	it('treats consecutive sentence-final marks (？！) in either order as a single boundary', () => {
		const text = '本当？！次に行きましょう。またね。';
		const candidates = findCandidates(text, new Set(['。', '！', '？']));
		const boundaryChars = candidates.map((c) => Array.from(text.slice(0, c.charIndex)).join(''));
		expect(boundaryChars).toEqual(['本当？！', '本当？！次に行きましょう。']);
	});

	it('combines a consecutive-mark run with a trailing closing quote correctly', () => {
		const text = '「本当！？」次に行きましょう。またね。';
		const candidates = findCandidates(text, new Set(['。', '！', '？']));
		const boundaryChars = candidates.map((c) => Array.from(text.slice(0, c.charIndex)).join(''));
		expect(boundaryChars).toEqual(['「本当！？」', '「本当！？」次に行きましょう。']);
	});
});

describe('findBestSilence (code review regression)', () => {
	it('rejects a window whose midpoint falls in range but whose full span extends outside it', () => {
		// Midpoint (1450) is inside [1000, 1500], but the window itself runs
		// to 1700 — past the requested range's own end.
		const window: SilenceWindow = { startMs: 1200, endMs: 1700 };
		const result = findBestSilence(1450, [window], 1000, 1500);
		expect(result).toBeNull();
	});

	it('accepts a window whose full span lies within the range', () => {
		const window: SilenceWindow = { startMs: 1200, endMs: 1400 };
		const result = findBestSilence(1300, [window], 1000, 1500);
		expect(result).toEqual(window);
	});

	it('prefers the closest qualifying window over the longest one', () => {
		// Found in code review 2026-08-24: the original rule picked whichever
		// qualifying window was longest, so a real 150ms pause sitting right
		// at expectedMs could lose to an unrelated 2s+ silence elsewhere in
		// the margin — resolving a precisely-estimated boundary to the wrong
		// pause, which then cuts and verifies cleanly (content-match/coverage
		// are audio-to-audio checks, with no way to catch a wrong-but-valid
		// boundary) while actually containing the wrong span.
		const near: SilenceWindow = { startMs: 4950, endMs: 5100 }; // 150ms, close
		const far: SilenceWindow = { startMs: 2000, endMs: 4200 }; // 2200ms, far
		const result = findBestSilence(5000, [far, near], 0, 6000, 2500);
		expect(result).toEqual(near);
	});

	it('falls back to the longest window only when two candidates are equidistant', () => {
		const a: SilenceWindow = { startMs: 4800, endMs: 4900 }; // 100ms, midpoint 150ms from expected
		const b: SilenceWindow = { startMs: 5000, endMs: 5300 }; // 300ms, midpoint also 150ms from expected
		const result = findBestSilence(5000, [a, b], 0, 6000, 2500);
		expect(result).toEqual(b);
	});

	it('accepts an explicit marginMs tighter than the default, rejecting anything outside it', () => {
		const window: SilenceWindow = { startMs: 1900, endMs: 2000 };
		expect(findBestSilence(1000, [window], 0, 3000, 800)).toBeNull();
		expect(findBestSilence(1000, [window], 0, 3000, 1200)).toEqual(window);
	});
});

describe('locateChunks — coverage', () => {
	it('produces contiguous, non-overlapping chunks whose transcripts concatenate back to the source, for varied inputs', () => {
		const sentences = ['一文目です', '二文目です', '三文目です', '四文目です'];
		const transcript = sentences.map((s) => `${s}。`).join('');
		const plan: ChunkPlanEntry[] = sentences.map((s) => ({ text: `${s}。` }));
		const segLen = 3000;
		const gap = 300;
		let t = 0;
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

		const result = locateChunks(plan, transcript, [], whisperSegments, silences, t);

		expect(result.ok).toBe(true);
		expect(result.chunks.length).toBe(sentences.length);
		for (let i = 1; i < result.chunks.length; i++) {
			expect(result.chunks[i].startMs).toBeGreaterThanOrEqual(
				result.chunks[i - 1].startMs + result.chunks[i - 1].durationMs
			);
		}
		const joined = result.chunks.map((c) => c.transcript).join('');
		expect(joined).toBe(transcript);
	});
});

describe('locateChunks — ASR content-coverage gate (code review regression 2026-08-26)', () => {
	// Mirrors a real production recording where whisper's -ml 1 pass produced
	// a near-gapless timeline (no internal gap over 20ms, so
	// hasSufficientCharTimingCoverage's time-gap check alone passed) but had
	// silently skipped over 60% of the actual spoken content — the fraction-
	// based spine lookup was then resolving boundaries against a spine whose
	// characters didn't correspond to the transcript's characters at all past
	// the first few. The coarser whisperSegments pass independently
	// under-recognized a similar fraction of the same recording, so this test
	// covers both passes failing content coverage together, not just one.
	it('aborts the whole recording when neither ASR pass recognized enough of the transcript content to trust, even with a gapless charTimings timeline', () => {
		const transcript =
			'一文目はそこそこ長い内容です。二文目もかなり長い内容が続きます。三文目はさらに長い内容になります。';
		const plan: ChunkPlanEntry[] = [
			{ text: '一文目はそこそこ長い内容です。' },
			{ text: '二文目もかなり長い内容が続きます。三文目はさらに長い内容になります。' }
		];
		// Gapless in time (each entry starts right where the last ended) but
		// only spells out a small fraction of the real transcript's content —
		// the scenario hasSufficientCharTimingCoverage alone can't catch.
		const charTimings: WhisperSegment[] = [
			{ startMs: 0, endMs: 500, text: '一' },
			{ startMs: 500, endMs: 1000, text: '文' },
			{ startMs: 1000, endMs: 1500, text: '目' },
			{ startMs: 28500, endMs: 29000, text: 'り' },
			{ startMs: 29000, endMs: 29500, text: 'ま' },
			{ startMs: 29500, endMs: 30000, text: 'す' }
		];
		// Also badly under-recognized, same as the real recording's coarse
		// pass — confirms the abort doesn't depend on which pass is checked.
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 0, endMs: 1500, text: '一文目' },
			{ startMs: 28500, endMs: 30000, text: 'り ます' }
		];
		const silences: SilenceWindow[] = [{ startMs: 14900, endMs: 15100 }];

		const result = locateChunks(plan, transcript, charTimings, whisperSegments, silences, 30000);

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.failures.join(' ')).toMatch(/recognized enough of this recording/);
		}
	});

	it('still locates normally when charTimings has good content coverage despite a real leading silence (not a regression of the existing time-gap check)', () => {
		const transcript = '一文目です。二文目です。';
		const plan: ChunkPlanEntry[] = [{ text: '一文目です。' }, { text: '二文目です。' }];
		const charTimings: WhisperSegment[] = [
			{ startMs: 4000, endMs: 4500, text: '一' },
			{ startMs: 4500, endMs: 5000, text: '文' },
			{ startMs: 5000, endMs: 5500, text: '目' },
			{ startMs: 5500, endMs: 6000, text: 'で' },
			{ startMs: 6000, endMs: 6500, text: 'す' },
			{ startMs: 8500, endMs: 9000, text: '二' },
			{ startMs: 9000, endMs: 9500, text: '文' },
			{ startMs: 9500, endMs: 10000, text: '目' },
			{ startMs: 10000, endMs: 10500, text: 'で' },
			{ startMs: 10500, endMs: 11000, text: 'す' }
		];
		const whisperSegments: WhisperSegment[] = [
			{ startMs: 4000, endMs: 6500, text: '一文目です' },
			{ startMs: 8500, endMs: 11000, text: '二文目です' }
		];
		const silences: SilenceWindow[] = [
			{ startMs: 0, endMs: 4000 },
			{ startMs: 6800, endMs: 8200 }
		];

		const result = locateChunks(plan, transcript, charTimings, whisperSegments, silences, 12000);

		expect(result.ok).toBe(true);
	});
});
