/**
 * Pure boundary-selection logic for the shadowing ingest pipeline: given a
 * transcript, whisper's own segment timings, and the source's detected
 * silence windows, decides where to cut. No I/O — everything that shells
 * out (whisper, ffmpeg) lives in transcribe.ts/audio-tools.ts, which call
 * into this module with already-gathered data. See chunk-planner.test.ts
 * for the regression cases this encodes.
 */

export interface WhisperSegment {
	startMs: number;
	endMs: number;
	text: string;
}

export interface SilenceWindow {
	startMs: number;
	endMs: number;
}

export interface PlannedChunk {
	startMs: number;
	durationMs: number;
	transcript: string;
}

export interface ChunkPlannerInput {
	transcript: string;
	durationMs: number;
	whisperSegments: WhisperSegment[];
	silences: SilenceWindow[];
}

// --- Tuning constants ---------------------------------------------------
//
// TARGET_MS/MAX_MS/MIN_MS and the pre-attack/tail buffers below are an
// UNTESTED GUESS, extrapolated from exactly one human judgement call (see
// notes/shadowing-practice-design.md's "Revised again, same day" entry —
// re-merging three comma-split fragments into one ~12s chunk on one real
// recording, while a neighboring similarly-sized fragment stayed split).
// They are NOT expected to reproduce that exact hand-merged grouping, or
// any other specific hand-cut result, on a new recording — going fully
// automatic means accepting that cost in exchange for never needing a
// human review step per recording. If real usage shows chunks consistently
// too long, too short, or too choppy, retune the constants here and
// re-chunk — `chunking_version` in the DB schema makes a re-chunk
// non-destructive to progress on already-cut audio (see
// supabase/README.md's "Shadowing tables" section for why).
export const TARGET_MS = 8_000;
export const MAX_MS = 14_000;
export const MIN_MS = 2_500;

// How far, in either direction, an ASR-estimated boundary time may be from
// a real silence window and still count as "the same boundary". Wide
// because whisper's own timestamps were found to be off by up to ~1.9s on
// real data even after DTW refinement — see notes/shadowing-practice-
// design.md's "Key finding" section. The proportional-position estimate
// this module uses (see estimateTimeMs) adds its own slack on top, which
// is exactly what this margin exists to absorb.
const BOUNDARY_SEARCH_MARGIN_MS = 2_500;

// Pull a chunk's start back into the preceding quiet zone before the
// fade-in ramps through it, and extend its end into the following quiet
// zone for the natural decay tail. Found necessary 2026-08-13: a cut point
// sitting exactly at a consonant's attack, combined with even a short
// fade-in, audibly swallowed the consonant (a clipped だ in だから).
// Deliberately never applied to the very first or last chunk's outer edge
// — there is no "preceding"/"following" audio there to pull into or
// extend toward.
export const PRE_ATTACK_MS = 75;
export const TAIL_MS = 200;

const SENTENCE_FINAL_MARKS = new Set(['。', '！', '？']);
const CLAUSE_COMMA_MARKS = new Set(['、']);
const BRACKET_MARKS = new Set(['「', '」', '『', '』']);

// Forces a merge across the boundary regardless of whether a real pause
// exists there — confirmed necessary in testing: whisper's own
// segmentation broke at a natural breath pause mid-sentence (before a
// comma, not a period) that would have made a bad shadowing-chunk boundary
// if cut there. Subject to the MAX_MS cap like any other merge, via the
// same comma-split fallback applied to any other over-long chunk.
const DISCOURSE_CONNECTORS = ['そして', 'だけど', 'でも', 'だから', 'それで', 'なので', 'けど'];

function isPunctuationOrSpace(ch: string): boolean {
	return (
		SENTENCE_FINAL_MARKS.has(ch) ||
		CLAUSE_COMMA_MARKS.has(ch) ||
		BRACKET_MARKS.has(ch) ||
		/\s/.test(ch)
	);
}

interface CandidateBoundary {
	charIndex: number; // index into the source text, right after the mark
}

/** Finds every occurrence of a mark set, as an index right after the mark. A mark as the very last character produces no boundary — there's nothing after it to cut off. */
function findCandidates(text: string, marks: Set<string>): CandidateBoundary[] {
	const boundaries: CandidateBoundary[] = [];
	let idx = 0;
	for (const ch of text) {
		idx += ch.length;
		if (marks.has(ch) && idx < text.length) boundaries.push({ charIndex: idx });
	}
	return boundaries;
}

function spineLength(text: string): number {
	let count = 0;
	for (const ch of text) if (!isPunctuationOrSpace(ch)) count++;
	return count;
}

interface AsrSpineChar {
	timeMs: number;
}

/** One entry per non-punctuation character across all segments, each carrying an interpolated time within its segment's span. */
function buildAsrSpine(segments: WhisperSegment[]): AsrSpineChar[] {
	const spine: AsrSpineChar[] = [];
	for (const seg of segments) {
		const chars = Array.from(seg.text).filter((c) => !isPunctuationOrSpace(c));
		if (chars.length === 0) continue;
		const span = Math.max(seg.endMs - seg.startMs, 1);
		chars.forEach((_, i) => {
			spine.push({ timeMs: seg.startMs + (span * (i + 0.5)) / chars.length });
		});
	}
	return spine;
}

/**
 * Approximate expected time for a transcript character position, via
 * proportional-position lookup into the whisper segment spine —
 * deliberately not a strict character-index alignment, since the final
 * transcript's wording (disfluencies kept, hallucinations removed) doesn't
 * always match whisper's own independent transcription exactly. Proportional
 * position degrades gracefully under that kind of small length mismatch;
 * BOUNDARY_SEARCH_MARGIN_MS absorbs the rest.
 */
function estimateTimeMs(
	charIndex: number,
	transcript: string,
	asrSpine: AsrSpineChar[],
	transcriptSpineLength: number,
	durationMs: number
): number {
	if (asrSpine.length === 0 || transcriptSpineLength === 0 || transcript.length === 0) {
		return transcript.length === 0 ? 0 : (charIndex / transcript.length) * durationMs;
	}
	const fraction = spineLength(transcript.slice(0, charIndex)) / transcriptSpineLength;
	const asrIndex = Math.max(
		0,
		Math.min(asrSpine.length - 1, Math.round(fraction * asrSpine.length))
	);
	return asrSpine[asrIndex].timeMs;
}

/** Longest silence window whose midpoint falls within the search margin of expectedMs and within [rangeStartMs, rangeEndMs], or null if none qualifies. */
function findBestSilence(
	expectedMs: number,
	silences: SilenceWindow[],
	rangeStartMs: number,
	rangeEndMs: number
): SilenceWindow | null {
	let best: SilenceWindow | null = null;
	for (const w of silences) {
		const mid = (w.startMs + w.endMs) / 2;
		if (mid < rangeStartMs || mid > rangeEndMs) continue;
		if (Math.abs(mid - expectedMs) > BOUNDARY_SEARCH_MARGIN_MS) continue;
		if (!best || w.endMs - w.startMs > best.endMs - best.startMs) best = w;
	}
	return best;
}

/**
 * Keeps only cuts (already in transcript/charIndex order, i.e.
 * chronological) whose resolved window starts strictly after the previous
 * ACCEPTED cut's window ends — dropping any candidate whose independently-
 * found window is shared with, or falls before, one already accepted.
 *
 * findBestSilence resolves each candidate boundary independently, so two
 * nearby candidates (two sentence-final marks close together, or the ASR
 * time estimate being imprecise) can both match the same real silence
 * window, or resolve to windows out of chronological order. Left
 * unfiltered, the caller's cursor-based loop then builds a fragment whose
 * end is before its start (or overlaps the next one) — not silently wrong
 * data, since verifyCoverage's non-positive-duration/overlap checks catch
 * it, but a real recording that should ingest cleanly aborts instead. A
 * dropped candidate here is treated exactly like one findBestSilence
 * already couldn't resolve: not a cut opportunity at this pass, not an
 * error.
 */
export function enforceMonotonicWindows<T extends { window: SilenceWindow }>(cuts: T[]): T[] {
	const accepted: T[] = [];
	let lastAcceptedEndMs = -Infinity;
	for (const cut of cuts) {
		if (cut.window.startMs < lastAcceptedEndMs) continue;
		accepted.push(cut);
		lastAcceptedEndMs = cut.window.endMs;
	}
	return accepted;
}

function startsWithDiscourseConnector(text: string): boolean {
	const trimmed = text.trimStart();
	return DISCOURSE_CONNECTORS.some((c) => trimmed.startsWith(c));
}

interface Fragment {
	startMs: number;
	endMs: number;
	/** Index into the full transcript where this fragment's text begins — threaded through every merge below so a later comma-split can map its local cut positions back to absolute time estimates without re-searching the full transcript. */
	charStart: number;
	transcript: string;
	/** The silence window whose end defined this fragment's raw start, or null for the very first fragment. */
	leadingSilence: SilenceWindow | null;
	/** The silence window whose start defined this fragment's raw end, or null for the very last fragment. */
	trailingSilence: SilenceWindow | null;
}

/**
 * Greedily merges adjacent fragments toward TARGET_MS, never past MAX_MS,
 * and always pulls in a fragment that would otherwise stand alone below
 * MIN_MS — even once the accumulator has already reached target — as long
 * as the pull still fits under MAX_MS. Without that last clause a small
 * trailing fragment could be stranded below MIN_MS just because its
 * predecessor happened to already be at target size.
 */
function greedyMergeToward(fragments: Fragment[]): Fragment[] {
	if (fragments.length === 0) return [];
	const merged: Fragment[] = [];
	let acc = fragments[0];
	for (let i = 1; i < fragments.length; i++) {
		const next = fragments[i];
		const accDuration = acc.endMs - acc.startMs;
		const nextDuration = next.endMs - next.startMs;
		const combinedDuration = next.endMs - acc.startMs;
		const shouldPull = accDuration < TARGET_MS || accDuration < MIN_MS || nextDuration < MIN_MS;
		if (shouldPull && combinedDuration <= MAX_MS) {
			acc = {
				startMs: acc.startMs,
				endMs: next.endMs,
				charStart: acc.charStart,
				transcript: acc.transcript + next.transcript,
				leadingSilence: acc.leadingSilence,
				trailingSilence: next.trailingSilence
			};
		} else {
			merged.push(acc);
			acc = next;
		}
	}
	merged.push(acc);
	return merged;
}

/**
 * Splits an over-long fragment at commas it actually contains (never an
 * invented pause boundary), each resolved to a real silence window within
 * the fragment's own time span — then re-merges just those pieces toward
 * the target, scoped to this fragment alone so the re-merge can't pull in
 * a chunk from elsewhere in the recording. Returns the original fragment
 * unchanged, still over MAX_MS, if it has no comma with a nearby silence
 * window to cut on — accepting an over-length chunk is preferable to
 * fabricating a cut with nothing real to anchor it to; the in-app Flag
 * button is the safety net for a chunk that turns out uncomfortable to
 * shadow.
 */
function splitAtCommas(
	fragment: Fragment,
	silences: SilenceWindow[],
	asrSpine: AsrSpineChar[],
	fullTranscript: string,
	transcriptSpineLength: number,
	durationMs: number
): Fragment[] {
	const candidates = findCandidates(fragment.transcript, CLAUSE_COMMA_MARKS);
	const cuts: { localCharIndex: number; window: SilenceWindow }[] = [];
	for (const c of candidates) {
		const absoluteCharIndex = fragment.charStart + c.charIndex;
		const expected = estimateTimeMs(
			absoluteCharIndex,
			fullTranscript,
			asrSpine,
			transcriptSpineLength,
			durationMs
		);
		const window = findBestSilence(expected, silences, fragment.startMs, fragment.endMs);
		if (window) cuts.push({ localCharIndex: c.charIndex, window });
	}
	if (cuts.length === 0) return [fragment];

	cuts.sort((a, b) => a.localCharIndex - b.localCharIndex);
	const monotonicCuts = enforceMonotonicWindows(cuts);
	if (monotonicCuts.length === 0) return [fragment];
	const pieces: Fragment[] = [];
	let cursorMs = fragment.startMs;
	let cursorChar = 0;
	let leading = fragment.leadingSilence;
	for (const cut of monotonicCuts) {
		pieces.push({
			startMs: cursorMs,
			endMs: cut.window.startMs,
			charStart: fragment.charStart + cursorChar,
			transcript: fragment.transcript.slice(cursorChar, cut.localCharIndex),
			leadingSilence: leading,
			trailingSilence: cut.window
		});
		cursorMs = cut.window.endMs;
		cursorChar = cut.localCharIndex;
		leading = cut.window;
	}
	pieces.push({
		startMs: cursorMs,
		endMs: fragment.endMs,
		charStart: fragment.charStart + cursorChar,
		transcript: fragment.transcript.slice(cursorChar),
		leadingSilence: leading,
		trailingSilence: fragment.trailingSilence
	});
	return pieces;
}

function clamp(v: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, v));
}

export function planChunks(input: ChunkPlannerInput): PlannedChunk[] {
	const { transcript, durationMs, whisperSegments, silences } = input;
	const asrSpine = buildAsrSpine(whisperSegments);
	const transcriptSpineLength = spineLength(transcript);

	// Phase A: sentence-final candidates, each resolved to a real silence
	// window if one exists nearby, dropped otherwise — a dropped candidate
	// simply isn't a cut opportunity yet; it may still become one via
	// phase D's comma-splitting if it ends up part of an over-long chunk.
	const sentenceCandidates = findCandidates(transcript, SENTENCE_FINAL_MARKS);
	const resolvedCuts: { charIndex: number; window: SilenceWindow }[] = [];
	for (const c of sentenceCandidates) {
		const expected = estimateTimeMs(
			c.charIndex,
			transcript,
			asrSpine,
			transcriptSpineLength,
			durationMs
		);
		const window = findBestSilence(expected, silences, 0, durationMs);
		if (window) resolvedCuts.push({ charIndex: c.charIndex, window });
	}
	const monotonicResolvedCuts = enforceMonotonicWindows(resolvedCuts);

	const fragments: Fragment[] = [];
	let cursorMs = 0;
	let cursorChar = 0;
	let leading: SilenceWindow | null = null;
	for (const cut of monotonicResolvedCuts) {
		fragments.push({
			startMs: cursorMs,
			endMs: cut.window.startMs,
			charStart: cursorChar,
			transcript: transcript.slice(cursorChar, cut.charIndex),
			leadingSilence: leading,
			trailingSilence: cut.window
		});
		cursorMs = cut.window.endMs;
		cursorChar = cut.charIndex;
		leading = cut.window;
	}
	fragments.push({
		startMs: cursorMs,
		endMs: durationMs,
		charStart: cursorChar,
		transcript: transcript.slice(cursorChar),
		leadingSilence: leading,
		trailingSilence: null
	});

	// Phase B: discourse-connector merge.
	const connectorMerged: Fragment[] = [];
	for (const fragment of fragments) {
		const prev = connectorMerged[connectorMerged.length - 1];
		if (prev && startsWithDiscourseConnector(fragment.transcript)) {
			connectorMerged[connectorMerged.length - 1] = {
				startMs: prev.startMs,
				endMs: fragment.endMs,
				charStart: prev.charStart,
				transcript: prev.transcript + fragment.transcript,
				leadingSilence: prev.leadingSilence,
				trailingSilence: fragment.trailingSilence
			};
		} else {
			connectorMerged.push({ ...fragment });
		}
	}

	// Phase C: greedy duration-target merge.
	const targetMerged = greedyMergeToward(connectorMerged);

	// Phase D: comma-split anything still over MAX_MS, then re-merge just
	// those pieces toward the target.
	const final: Fragment[] = [];
	for (const chunk of targetMerged) {
		if (chunk.endMs - chunk.startMs <= MAX_MS) {
			final.push(chunk);
			continue;
		}
		const pieces = splitAtCommas(
			chunk,
			silences,
			asrSpine,
			transcript,
			transcriptSpineLength,
			durationMs
		);
		if (pieces.length === 1) {
			final.push(chunk);
		} else {
			final.push(...greedyMergeToward(pieces));
		}
	}

	// Phase E: pre-attack/tail adjustment on every surviving boundary,
	// using each chunk's own leading/trailing silence window — carried
	// through every merge above — never the raw fragment edges. The first
	// chunk's start and the last chunk's end are left untouched: there is
	// no preceding/following audio there to adjust into.
	return final.map((chunk, i) => {
		const startMs =
			i === 0 || !chunk.leadingSilence
				? chunk.startMs
				: clamp(
						chunk.leadingSilence.endMs - PRE_ATTACK_MS,
						chunk.leadingSilence.startMs,
						chunk.leadingSilence.endMs
					);
		const endMs =
			i === final.length - 1 || !chunk.trailingSilence
				? chunk.endMs
				: clamp(
						chunk.trailingSilence.startMs + TAIL_MS,
						chunk.trailingSilence.startMs,
						chunk.trailingSilence.endMs
					);
		return {
			startMs,
			durationMs: Math.max(endMs - startMs, 1),
			transcript: chunk.transcript.trim()
		};
	});
}
