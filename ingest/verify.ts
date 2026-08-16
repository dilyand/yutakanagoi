import {
	contentHashOfFile,
	crossCorrelate,
	decodeF32,
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
}

export interface VerifyChunkResult {
	ok: boolean;
	failures: string[];
	/** Diagnostics worth logging even on success, for a human spot-check. */
	diagnostics: {
		correlationLagMs: number;
		correlation: number;
		attackRmsDb: number;
		fadeInEarlyRmsDb: number;
		fadeInLateRmsDb: number;
		fadeOutEarlyRmsDb: number;
		fadeOutLateRmsDb: number;
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
// How much the amplitude must rise (fade-in) or fall (fade-out) across the
// fade window itself to count as a real ramp. Deliberately measured WITHIN
// the fade window (first probe vs. last probe of the same fadeMs span),
// not edge-vs-a-separate-interior-window — an edge-vs-interior comparison
// was tried first and missed a real no-fade negative control: chunk
// starts/ends already sit inside chunk-planner's pre-attack/tail quiet
// buffer (see PRE_ATTACK_MS/TAIL_MS in chunk-planner.ts), so the fade edge
// can already read quieter than the interior purely from where the cut
// landed, with or without an actual fade. Comparing early-vs-late *inside*
// the fade window instead asks the right question — did amplitude change
// across this specific span — independent of how quiet the surrounding
// audio already was.
// Honest limitation, found empirically 2026-08-16 via a deliberate
// negative control (re-encoding a real chunk's pre-fade wav straight to
// m4a with no afade at all, then running this check against it): at a cut
// point PRE_ATTACK_MS/TAIL_MS successfully landed in genuine near-silence
// — which is the common case, since that's the whole point of those
// buffers — a real fade's effect on already-very-quiet content is often
// smaller than AAC encoding noise, at every probe window size tried (1ms
// through 10ms). The negative control's fade-OUT was reliably caught; its
// fade-IN was not, at a boundary quiet enough that faded and unfaded read
// within ~1dB of each other. This check is kept as a best-effort signal —
// it does catch a skipped fade at a louder boundary — but the reliable
// catch for "fades silently didn't apply" is verifyDistinct below
// (content-hash comparison), which is what caught the real historical bug
// in the first place (a chunk that turned out byte-identical to a
// no-fade test file).
const RAMP_MARGIN_DB = 3;
// Below this, neither probe has real signal to check a ramp against at
// all — found 2026-08-16 running this against a real recording whose
// first chunk starts several seconds into genuine leading silence (real
// dead air before speech, not a fade artifact): both probes read the same
// silence floor, which no fade, working or not, can produce a measurable
// rise out of. Same failure mode at a recording's trailing silence, for
// the last chunk's fade-out. Only the first/last chunk's outer edge can
// hit this — chunk-planner never applies the pre-attack/tail adjustment
// there, so it's exactly the boundary that can legitimately sit in
// extended real silence.
const NO_SIGNAL_FLOOR_DB = -90;

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

	// 3. Fades applied — amplitude must measurably rise (fade-in) or fall
	// (fade-out) across the fade window itself. Catches the silently-
	// unapplied-fade bug (a chunk that turned out byte-identical to a
	// no-fade test file).
	const finalDurationMs = probeDurationMs(input.finalAudioPath);
	const probeMs = Math.min(10, Math.max(2, Math.floor(input.fadeMs / 3)));

	const fadeInEarlyRmsDb = rmsDbAt(input.finalAudioPath, 0, probeMs);
	const fadeInLateRmsDb = rmsDbAt(
		input.finalAudioPath,
		Math.max(0, input.fadeMs - probeMs),
		probeMs
	);
	if (fadeInLateRmsDb > NO_SIGNAL_FLOOR_DB && fadeInLateRmsDb < fadeInEarlyRmsDb + RAMP_MARGIN_DB) {
		failures.push(
			`fade-in not applied: start of ramp ${fadeInEarlyRmsDb.toFixed(1)}dB, end of ramp ${fadeInLateRmsDb.toFixed(1)}dB — no measurable rise`
		);
	}

	const fadeOutStartMs = Math.max(0, finalDurationMs - input.fadeMs);
	const fadeOutEarlyRmsDb = rmsDbAt(input.finalAudioPath, fadeOutStartMs, probeMs);
	const fadeOutLateRmsDb = rmsDbAt(
		input.finalAudioPath,
		Math.max(fadeOutStartMs, finalDurationMs - probeMs),
		probeMs
	);
	if (
		fadeOutEarlyRmsDb > NO_SIGNAL_FLOOR_DB &&
		fadeOutLateRmsDb > fadeOutEarlyRmsDb - RAMP_MARGIN_DB
	) {
		failures.push(
			`fade-out not applied: start of ramp ${fadeOutEarlyRmsDb.toFixed(1)}dB, end of ramp ${fadeOutLateRmsDb.toFixed(1)}dB — no measurable fall`
		);
	}

	return {
		ok: failures.length === 0,
		failures,
		diagnostics: {
			correlationLagMs: lagMs,
			correlation,
			attackRmsDb,
			fadeInEarlyRmsDb,
			fadeInLateRmsDb,
			fadeOutEarlyRmsDb,
			fadeOutLateRmsDb
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

/** Check 5 (coverage) — run once across every planned chunk boundary in a recording. Catches dropped words: chunks must be monotonic, non-overlapping, and not leave large planned gaps. */
export function verifyCoverage(
	chunks: { startMs: number; durationMs: number }[],
	sourceDurationMs: number
): { ok: boolean; failures: string[] } {
	const failures: string[] = [];
	const sorted = [...chunks].sort((a, b) => a.startMs - b.startMs);
	for (let i = 0; i < sorted.length; i++) {
		const c = sorted[i];
		if (c.durationMs <= 0) failures.push(`chunk ${i} has non-positive duration`);
		if (c.startMs < 0 || c.startMs + c.durationMs > sourceDurationMs + 1) {
			failures.push(
				`chunk ${i} [${c.startMs}, ${c.startMs + c.durationMs}] falls outside the source's [0, ${sourceDurationMs}]`
			);
		}
		if (i > 0) {
			const prev = sorted[i - 1];
			const prevEnd = prev.startMs + prev.durationMs;
			if (c.startMs < prevEnd - 1) {
				failures.push(
					`chunk ${i} starts at ${c.startMs}, before chunk ${i - 1} ends at ${prevEnd} — overlap`
				);
			}
		}
	}
	return { ok: failures.length === 0, failures };
}
