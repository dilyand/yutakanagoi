import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	contentHashOfFile,
	crossCorrelate,
	decodeF32,
	encodeWithoutFade,
	probeDurationMs,
	rmsDbAt,
	SAMPLE_RATE
} from './audio-tools.ts';

/**
 * The verification step the design notes insist on — this is how all three
 * real silent ffmpeg bugs found during the manual feasibility work were
 * actually caught, not a one-off sanity check done by hand. Every check
 * here runs on every chunk during `ingest:cut`; a failure aborts the whole
 * command before anything is uploaded or inserted (see cut.ts).
 */

export interface VerifyChunkInput {
	/** The chunk BEFORE fades were applied — content-match and attack checks need the raw trim, since fades intentionally attenuate the very edges they'd otherwise be checking. */
	preFadeWav: string;
	/** The final, fade-applied chunk audio (m4a). */
	finalAudioPath: string;
	/** The full source recording's 16k mono analysis wav. */
	sourceWav: string;
	startMs: number;
	durationMs: number;
	fadeMs: number;
	/**
	 * Whether this is the recording's absolute last chunk — every OTHER
	 * chunk's end lands on a real, independently-detected SilenceWindow (by
	 * construction of chunk-planner's boundary selection), so it's already
	 * safe to fade. The recording's own final edge has no such guarantee:
	 * chunk-planner never adjusts it (there's no following audio to extend
	 * into — see its Phase E), yet applyFades still unconditionally fades
	 * it. Triggers the tail-quiet check below.
	 */
	isLastChunk: boolean;
}

export interface VerifyChunkResult {
	ok: boolean;
	failures: string[];
	/** Diagnostics worth logging even on success, for a human spot-check. */
	diagnostics: {
		correlationLagMs: number;
		correlation: number;
		attackRmsDb: number;
		tailRmsDb: number | null;
		fadeInFinalRmsDb: number;
		fadeInControlRmsDb: number;
		fadeOutFinalRmsDb: number;
		fadeOutControlRmsDb: number;
	};
}

// Thresholds. Not independently tuned against real data the way
// chunk-planner's constants were swept (see the threshold-tuning open
// item) — chosen conservatively enough that a genuinely correct cut should
// clear them with real margin, based on what the design notes' real bugs
// actually looked like (tens of ms of lag, a fade that either clearly
// ramped or didn't apply at all).
const MAX_LAG_MS = 250;
const MIN_CORRELATION = 0.9;
const QUIET_THRESHOLD_DB = -35;
// How much quieter the finished (faded) chunk must read than a same-content
// negative control — the identical trim, re-encoded with no afade at all
// (audio-tools.ts's encodeWithoutFade) — at the same instant, to count as a
// real fade.
//
// An earlier version of this check compared the fade window's own early
// probe against its late probe, entirely within the finished file. Found
// 2026-08-22 (code review) to be unsound in general, not just at quiet
// boundaries: it can pass even when afade silently never ran, as long as
// the underlying speech happens to have a naturally decaying envelope over
// that span — exactly the kind of content a fade window is often placed
// over. verifyDistinct's content-hash comparison below only catches a fade
// that produced a byte-identical duplicate of another chunk; it says
// nothing about any individual chunk's own fade. Comparing against a real
// per-chunk negative control removes both gaps: at the same instant, a
// genuinely faded file must read quieter than an unfaded rendering of the
// exact same audio, regardless of what the underlying content does on its
// own, and independent of any other chunk.
const RAMP_MARGIN_DB = 3;
// Below this, the control has no real signal to attenuate in the first
// place — a fade's effect on already-very-quiet content is often smaller
// than AAC encoding noise, at every probe window size tried (1ms through
// 10ms), so no comparison, self- or control-based, can reliably see an
// attenuation that small. This is the expected common case, not an edge
// case: chunk-planner's PRE_ATTACK_MS/TAIL_MS deliberately land every cut
// in a quiet zone, so most real chunks' fade edges sit here.
//
// Re-verified 2026-08-22 against all 14 chunks from the three real
// recordings this pipeline has actually ingested, after replacing the
// old within-file ramp check with the negative-control comparison above:
// every edge that read below -65.7dB on the unfaded control showed no
// reliably measurable difference from its faded counterpart (both readings
// landing within ~2dB of each other, encoding-noise territory) — even
// though every one of these chunks went through the same unconditional
// applyFades() call as every other chunk and has no reason to be missing
// its fade. -90 (carried over from the old check, which measured a
// different thing) was too permissive for this comparison and produced
// false failures on real, correctly-faded content; -60 clears every edge
// observed in that run with margin.
const NO_SIGNAL_FLOOR_DB = -60;
// Largest gap between (or before the first / after the last) planned chunk
// that still counts as an ordinary pause rather than a dropped region.
// chunk-planner doesn't merge across long, deliberate pauses, so a real
// gap between two correctly-planned chunks can be a second or more — the
// largest observed on real, already-verified data is ~1.65s
// (hellotalk-260812-0944-2-chunk3, chunk 1→2). Set with real margin above
// that; a dropped word or sentence is a much larger hole than this.
const MAX_GAP_MS = 3000;

function decodeChunkAndSourceRegion(
	preFadeWav: string,
	sourceWav: string,
	startMs: number,
	durationMs: number
): { needle: Float32Array; haystack: Float32Array; expectedOffsetSamples: number } {
	const needle = decodeF32(preFadeWav);
	const regionStart = Math.max(0, startMs - MAX_LAG_MS);
	const regionDuration = durationMs + 2 * MAX_LAG_MS;
	const haystack = decodeF32(sourceWav, { startMs: regionStart, durationMs: regionDuration });
	const expectedOffsetSamples = Math.round(((startMs - regionStart) / 1000) * SAMPLE_RATE);
	return { needle, haystack, expectedOffsetSamples };
}

export function verifyChunk(input: VerifyChunkInput): VerifyChunkResult {
	const failures: string[] = [];

	// 1. Content match — this is the check that actually catches the
	// -ss/-to snap bug (see audio-tools.ts's cutChunk); duration and file
	// size do not.
	const { needle, haystack, expectedOffsetSamples } = decodeChunkAndSourceRegion(
		input.preFadeWav,
		input.sourceWav,
		input.startMs,
		input.durationMs
	);
	const { lagMs, correlation } = crossCorrelate(needle, haystack, expectedOffsetSamples);
	if (Math.abs(lagMs) > MAX_LAG_MS) {
		failures.push(`content match: |lag| ${Math.abs(lagMs).toFixed(1)}ms exceeds ${MAX_LAG_MS}ms`);
	}
	if (correlation < MIN_CORRELATION) {
		failures.push(`content match: correlation ${correlation.toFixed(3)} below ${MIN_CORRELATION}`);
	}

	// 2. No cut on an attack — confirms the chunk begins in real quiet
	// (where a fade-in is safe), not mid-consonant.
	const attackRmsDb = rmsDbAt(input.preFadeWav, 0, 10);
	if (attackRmsDb > QUIET_THRESHOLD_DB) {
		failures.push(
			`attack check: chunk start is ${attackRmsDb.toFixed(1)}dB, not below ${QUIET_THRESHOLD_DB}dB`
		);
	}

	// 2b. Tail quiet enough to fade — the symmetric case of check 2, only
	// relevant for the recording's absolute last chunk. Every other chunk's
	// end lands on a real, independently-detected silence window by
	// construction (chunk-planner never chooses an internal boundary any
	// other way), so it's already known-safe. The recording's own final
	// edge has no such guarantee — chunk-planner leaves it exactly at EOF,
	// which could be genuine trailing silence or a recording cut off
	// mid-speech — yet applyFades still unconditionally fades it. Without
	// this check, check 3 below only proves a fade attenuated something; it
	// never proves there was silence there to attenuate safely, so a
	// recording ending on speech could pass every check while its last
	// sound is audibly swallowed by the fade curve.
	let tailRmsDb: number | null = null;
	if (input.isLastChunk) {
		const preFadeDurationMs = probeDurationMs(input.preFadeWav);
		tailRmsDb = rmsDbAt(input.preFadeWav, Math.max(0, preFadeDurationMs - 10), 10);
		if (tailRmsDb > QUIET_THRESHOLD_DB) {
			failures.push(
				`tail check: recording's final chunk ends at ${tailRmsDb.toFixed(1)}dB, not below ${QUIET_THRESHOLD_DB}dB — may be cut off mid-speech, unsafe to fade`
			);
		}
	}

	// 3. Fades applied — the finished (faded) chunk must read measurably
	// quieter than a same-content negative control at the most-attenuated
	// point of each fade (t=0 for fade-in, the last probeMs for fade-out).
	// See RAMP_MARGIN_DB's comment above for why this compares against a
	// real control instead of checking for a rise/fall within the finished
	// file alone.
	const finalDurationMs = probeDurationMs(input.finalAudioPath);
	const probeMs = Math.min(10, Math.max(2, Math.floor(input.fadeMs / 3)));

	const controlDir = mkdtempSync(path.join(tmpdir(), 'shadowing-fade-control-'));
	let fadeInFinalRmsDb: number;
	let fadeInControlRmsDb: number;
	let fadeOutFinalRmsDb: number;
	let fadeOutControlRmsDb: number;
	try {
		const controlPath = path.join(controlDir, 'control.m4a');
		encodeWithoutFade(input.preFadeWav, controlPath);
		const controlDurationMs = probeDurationMs(controlPath);

		fadeInFinalRmsDb = rmsDbAt(input.finalAudioPath, 0, probeMs);
		fadeInControlRmsDb = rmsDbAt(controlPath, 0, probeMs);
		if (
			fadeInControlRmsDb > NO_SIGNAL_FLOOR_DB &&
			fadeInFinalRmsDb > fadeInControlRmsDb - RAMP_MARGIN_DB
		) {
			failures.push(
				`fade-in not applied: faded ${fadeInFinalRmsDb.toFixed(1)}dB vs. unfaded control ${fadeInControlRmsDb.toFixed(1)}dB — no measurable attenuation`
			);
		}

		const fadeOutStartMs = Math.max(0, finalDurationMs - probeMs);
		const controlFadeOutStartMs = Math.max(0, controlDurationMs - probeMs);
		fadeOutFinalRmsDb = rmsDbAt(input.finalAudioPath, fadeOutStartMs, probeMs);
		fadeOutControlRmsDb = rmsDbAt(controlPath, controlFadeOutStartMs, probeMs);
		if (
			fadeOutControlRmsDb > NO_SIGNAL_FLOOR_DB &&
			fadeOutFinalRmsDb > fadeOutControlRmsDb - RAMP_MARGIN_DB
		) {
			failures.push(
				`fade-out not applied: faded ${fadeOutFinalRmsDb.toFixed(1)}dB vs. unfaded control ${fadeOutControlRmsDb.toFixed(1)}dB — no measurable attenuation`
			);
		}
	} finally {
		rmSync(controlDir, { recursive: true, force: true });
	}

	return {
		ok: failures.length === 0,
		failures,
		diagnostics: {
			correlationLagMs: lagMs,
			correlation,
			attackRmsDb,
			tailRmsDb,
			fadeInFinalRmsDb,
			fadeInControlRmsDb,
			fadeOutFinalRmsDb,
			fadeOutControlRmsDb
		}
	};
}

/** Check 4 (distinctness) — run once across every finished chunk in a recording, not per-chunk. Catches the byte-identical-to-a-no-fade-test-file bug. */
export function verifyDistinct(finalAudioPaths: string[]): { ok: boolean; failures: string[] } {
	const seen = new Map<string, string>();
	const failures: string[] = [];
	for (const path of finalAudioPaths) {
		const hash = contentHashOfFile(path);
		const existing = seen.get(hash);
		if (existing) {
			failures.push(`${path} is byte-identical to ${existing}`);
		} else {
			seen.set(hash, path);
		}
	}
	return { ok: failures.length === 0, failures };
}

/**
 * Check 5 (coverage) — run once across every planned chunk boundary in a
 * recording. Catches dropped words: chunks must be monotonic,
 * non-overlapping, and not leave large planned gaps.
 *
 * Validates `chunks` in the exact order given — never sorted first. An
 * earlier version sorted a copy before checking, which defeats the whole
 * point of a monotonicity check: if the planner itself ever returned
 * chunks out of order (the actual regression this check exists to catch),
 * sorting would silently "fix" that for verification purposes while
 * cut.ts still writes chunks.json's indices and transcripts in the
 * original, wrong order.
 */
export function verifyCoverage(
	chunks: { startMs: number; durationMs: number }[],
	sourceDurationMs: number
): { ok: boolean; failures: string[] } {
	const failures: string[] = [];
	for (let i = 0; i < chunks.length; i++) {
		const c = chunks[i];
		if (c.durationMs <= 0) failures.push(`chunk ${i} has non-positive duration`);
		if (c.startMs < 0 || c.startMs + c.durationMs > sourceDurationMs + 1) {
			failures.push(
				`chunk ${i} [${c.startMs}, ${c.startMs + c.durationMs}] falls outside the source's [0, ${sourceDurationMs}]`
			);
		}
		if (i > 0) {
			const prev = chunks[i - 1];
			const prevEnd = prev.startMs + prev.durationMs;
			if (c.startMs < prevEnd - 1) {
				failures.push(
					`chunk ${i} starts at ${c.startMs}, before chunk ${i - 1} ends at ${prevEnd} — overlap`
				);
			} else if (c.startMs - prevEnd > MAX_GAP_MS) {
				failures.push(
					`chunk ${i} starts at ${c.startMs}, ${(c.startMs - prevEnd).toFixed(0)}ms after chunk ${i - 1} ends at ${prevEnd} — gap exceeds ${MAX_GAP_MS}ms, possible dropped audio`
				);
			}
		}
	}
	if (chunks.length > 0) {
		const first = chunks[0];
		if (first.startMs > MAX_GAP_MS) {
			failures.push(
				`recording starts ${first.startMs.toFixed(0)}ms before the first chunk — gap exceeds ${MAX_GAP_MS}ms, possible dropped audio`
			);
		}
		const last = chunks[chunks.length - 1];
		const lastEnd = last.startMs + last.durationMs;
		const trailingGapMs = sourceDurationMs - lastEnd;
		if (trailingGapMs > MAX_GAP_MS) {
			failures.push(
				`recording continues ${trailingGapMs.toFixed(0)}ms after the last chunk ends at ${lastEnd} — gap exceeds ${MAX_GAP_MS}ms, possible dropped audio`
			);
		}
	}
	return { ok: failures.length === 0, failures };
}
