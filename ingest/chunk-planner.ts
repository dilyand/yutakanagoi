/**
 * Pure text/audio-alignment logic for the shadowing ingest pipeline, split
 * into two deliberately separate concerns:
 *
 * - splitIntoSentenceUnits: text only, no audio at all. Splits a
 *   transcript into its atomic sentence-final-mark-bounded units — the
 *   scaffold plan-chunks.ts writes to chunk_plan.json for a human (or
 *   Claude) to group into final chunks by meaning.
 * - locateChunks: audio only, no grouping decisions. Given chunk_plan.json
 *   groupings that have already been decided, finds where each one
 *   actually falls in the real audio and where it's safe to cut cleanly.
 *
 * Earlier versions of this file made both decisions in one pass
 * (`planChunks`), gated on whether a text candidate happened to land near
 * a detected silence window — which conflated "do these sentences belong
 * together" with "is there a pause here," and produced boundaries that
 * looked arbitrary because they effectively were (see chunk-planner.test.ts
 * git history for the specific real-recording regressions this caused).
 * Splitting the two concerns means grouping is decided by something that
 * actually understands the content, and location/cutting is decided by
 * real audio data — each concern using the tool actually suited to it.
 *
 * No I/O in this file — everything that shells out (whisper, ffmpeg) lives
 * in transcribe.ts/audio-tools.ts, which callers combine with this
 * module's pure functions. See chunk-planner.test.ts for the regression
 * cases this encodes.
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

// How far, in either direction, an ASR-estimated boundary time may be from
// a real silence window and still count as "the same boundary" when only
// the coarse per-segment whisperSegments spine is available (no charTimings
// for this recording). Wide because whisper's own SEGMENT timestamps were
// found to be off by up to ~1.9s on real data even after DTW refinement
// (up to ~4.2s on one recording with an unusually long lead-in silence) —
// see notes/shadowing-practice-design.md's "Key finding" section.
const COARSE_BOUNDARY_SEARCH_MARGIN_MS = 2_500;

// Same margin, but for when the much finer per-character DTW spine
// (transcribeWavCharTimings) is available. Measured directly against
// every internal boundary in a real 9-recording, 18-boundary batch
// (2026-08-24): estimate-to-actual-window distance ranged 67-1345ms,
// median ~500ms — nowhere near needing the coarse margin above, but an
// earlier guess of 800ms here (based on eyeballing only 2 boundaries
// during design work, not measuring the real distribution) broke 7 of
// those 18 real, already-verified-correct boundaries. Set with real
// margin above the observed 1345ms max, not another guess. Kept tighter
// than the coarse fallback deliberately: findBestSilence still prefers
// the CLOSEST qualifying window, not the longest (see its own comment),
// but a wide margin still means more distant candidates to choose between
// in the first place — tightening this reduces how often a genuinely
// unrelated pause can even be a candidate when no real match exists
// nearby at all.
const CHAR_TIMING_BOUNDARY_SEARCH_MARGIN_MS = 1_800;

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
const CLOSING_BRACKET_MARKS = new Set(['」', '』']);

// A human- or ASR-generated transcript can type the half-width (ASCII)
// form of a mark instead of switching back to full-width IME input
// mid-sentence — found 2026-08-23 on a real recovered-audio batch: 4 of 9
// recordings had a half-width "?" or "!" that was silently invisible to
// SENTENCE_FINAL_MARKS entirely (which only ever matched the full-width
// forms), producing splits that looked arbitrary. Both splitIntoSentence
// Units and locateChunks normalize their transcript through this map
// before anything else runs — extend this map, not the mark sets above,
// if another half-width variant turns up. "?"/"!" have no legitimate
// non-terminal use in this content, so they're always converted; "."/","
// are NOT in this map — see normalizeMarkWidth below for why they need
// context, not a blind substitution.
const WIDTH_NORMALIZE_MAP: Record<string, string> = {
	'?': '？',
	'!': '！'
};

const ASCII_DIGIT = /[0-9]/;

/**
 * 1:1 character substitution only (no multi-char expansion), so char
 * indices into the result stay perfectly aligned with the original text.
 *
 * "."/"," get contextual treatment, not the blind map "?"/"!" use: a
 * half-width period or comma between two digits is a decimal point or a
 * thousands separator (3.5キロ, 1,000円), not a sentence/clause mark —
 * found in code review 2026-08-24, since blindly converting every one
 * would corrupt "3.5キロ" into "3。5キロ" (and split it into separate
 * sentence units) and "1,000円" into "1、000円", with the corrupted text
 * persisted into chunk_plan.json and ultimately shown to learners. Only
 * a "."/"," with a non-digit (or nothing) on either side is treated as
 * the Japanese mark it's standing in for.
 */
export function normalizeMarkWidth(text: string): string {
	const chars = Array.from(text);
	return chars
		.map((ch, i) => {
			if (ch === '.' || ch === ',') {
				const prev = chars[i - 1];
				const next = chars[i + 1];
				const isNumericSeparator =
					prev !== undefined &&
					next !== undefined &&
					ASCII_DIGIT.test(prev) &&
					ASCII_DIGIT.test(next);
				if (isNumericSeparator) return ch;
				return ch === '.' ? '。' : '、';
			}
			return WIDTH_NORMALIZE_MAP[ch] ?? ch;
		})
		.join('');
}

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

/**
 * Finds every occurrence of a mark set, as an index right after the mark —
 * advanced past any immediately-following run of the SAME mark set first
 * (e.g. "！？"), then past any immediately-following closing bracket
 * (」/』) and whitespace. Two fixes for the same underlying reason,
 * neither safe to skip:
 *
 * - Without the consecutive-mark advance, "本当！？次…" produces a
 *   candidate right after "！" (before "？") AND a separate one right
 *   after "？" — a chunk boundary could then land between them, starting
 *   the next chunk's hint text with a stray "？" (or giving the
 *   punctuation-only gap its own near-zero audio span).
 * - Without the closing-bracket/whitespace advance, a boundary right
 *   before a closing quote (e.g. the 。 in 「こんにちは。」次に…) splits the
 *   quote mark itself into the next chunk, leaving one chunk's hint text
 *   with an unmatched opening quote and the next's with a stray closing
 *   one.
 *
 * A mark as the very last character (after both advances) produces no
 * boundary — there's nothing after it to cut off.
 */
export function findCandidates(text: string, marks: Set<string>): CandidateBoundary[] {
	const boundaries: CandidateBoundary[] = [];
	const chars = Array.from(text);
	let idx = 0;
	let i = 0;
	while (i < chars.length) {
		const ch = chars[i];
		idx += ch.length;
		if (!marks.has(ch)) {
			i++;
			continue;
		}
		let boundaryIdx = idx;
		let j = i + 1;
		while (j < chars.length && marks.has(chars[j])) {
			boundaryIdx += chars[j].length;
			j++;
		}
		while (j < chars.length && (CLOSING_BRACKET_MARKS.has(chars[j]) || /\s/.test(chars[j]))) {
			boundaryIdx += chars[j].length;
			j++;
		}
		if (boundaryIdx < text.length) boundaries.push({ charIndex: boundaryIdx });
		idx = boundaryIdx;
		i = j;
	}
	return boundaries;
}

/**
 * Splits a transcript into its atomic sentence-final-mark-bounded units —
 * text only, no audio, no grouping decision. Each unit is an exact,
 * untrimmed slice of the (width-normalized) transcript, so concatenating
 * every returned unit reproduces the transcript exactly — locateChunks
 * relies on that same invariant holding for however plan-chunks.json's
 * entries get grouped afterward.
 */
export function splitIntoSentenceUnits(rawTranscript: string): string[] {
	const transcript = normalizeMarkWidth(rawTranscript);
	const candidates = findCandidates(transcript, SENTENCE_FINAL_MARKS);
	const units: string[] = [];
	let cursor = 0;
	for (const c of candidates) {
		units.push(transcript.slice(cursor, c.charIndex));
		cursor = c.charIndex;
	}
	if (cursor < transcript.length) units.push(transcript.slice(cursor));
	return units;
}

function spineLength(text: string): number {
	let count = 0;
	for (const ch of text) if (!isPunctuationOrSpace(ch)) count++;
	return count;
}

interface AsrSpineChar {
	timeMs: number;
}

/** One entry per non-punctuation character across all segments, each carrying an interpolated time within its segment's span. Works equally well fed coarse multi-sentence whisperSegments or fine per-character charTimings — a finer input segment just means less interpolation is needed per character. */
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
 * proportional-position lookup into an ASR spine — deliberately not a
 * strict character-index alignment, since the final transcript's wording
 * (disfluencies kept, hallucinations removed) doesn't always match
 * whisper's own independent transcription exactly. Proportional position
 * degrades gracefully under that kind of small length mismatch;
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
	// Each asrSpine[i] is the MIDPOINT of character i (see buildAsrSpine),
	// i.e. it sits at continuous position i + 0.5 along the spine, not at
	// position i. charIndex asks for the boundary — the GAP right before
	// character `fraction * asrSpine.length` — so subtracting 0.5 shifts
	// from "nearest character's own center" to that gap position, and the
	// two neighboring characters' times are linearly interpolated across
	// it. Found in code review 2026-08-24: the previous version rounded to
	// the single nearest spine index and returned its time directly — when
	// the transcript and ASR spines happened to be the same length, a
	// boundary after k characters landed exactly on asrIndex k, i.e. the
	// MIDPOINT of the character *after* the boundary, not the gap after
	// the character before it. That's a systematic late bias on every
	// estimate this exact-length case produced, not just an occasional
	// rounding wobble — material now that charTimings makes each spine
	// entry span only one character instead of a whole multi-second
	// segment.
	const gapPosition = fraction * asrSpine.length - 0.5;
	const lowIndex = Math.max(0, Math.min(asrSpine.length - 1, Math.floor(gapPosition)));
	const highIndex = Math.max(0, Math.min(asrSpine.length - 1, lowIndex + 1));
	const t = Math.max(0, Math.min(1, gapPosition - lowIndex));
	return asrSpine[lowIndex].timeMs * (1 - t) + asrSpine[highIndex].timeMs * t;
}

/**
 * Closest-to-expectedMs silence window (by midpoint distance, ties broken
 * by longest) whose midpoint falls within marginMs of expectedMs and whose
 * FULL span — not just its midpoint — lies within [rangeStartMs,
 * rangeEndMs], or null if none qualifies.
 *
 * Proximity-first, not longest-first: found in code review 2026-08-24 that
 * preferring the longest qualifying window (the original rule) can pick an
 * unrelated pause over the actually-correct one — e.g. a real 150ms pause
 * right at expectedMs losing to an unrelated 2s+ silence elsewhere in the
 * margin. That's a real risk for a boundary that was deliberately decided
 * (locateChunks' callers), not just a candidate that can be safely dropped:
 * the wrong window still produces a chunk whose audio cuts cleanly (passes
 * content-match/coverage — both are audio-to-audio checks with no concept
 * of transcript correspondence) while actually containing the wrong span.
 *
 * A midpoint-only containment check would let a window straddle the
 * boundary: a window whose midpoint falls just inside the range but whose
 * startMs/endMs extends past it could still get selected — producing a
 * boundary that doesn't correspond to silence actually contained within
 * the requested range.
 */
export function findBestSilence(
	expectedMs: number,
	silences: SilenceWindow[],
	rangeStartMs: number,
	rangeEndMs: number,
	marginMs: number = COARSE_BOUNDARY_SEARCH_MARGIN_MS
): SilenceWindow | null {
	let best: SilenceWindow | null = null;
	let bestDistanceMs = Infinity;
	for (const w of silences) {
		if (w.startMs < rangeStartMs || w.endMs > rangeEndMs) continue;
		const mid = (w.startMs + w.endMs) / 2;
		const distanceMs = Math.abs(mid - expectedMs);
		if (distanceMs > marginMs) continue;
		const isCloser = distanceMs < bestDistanceMs;
		const isTiedButLonger =
			best !== null &&
			distanceMs === bestDistanceMs &&
			w.endMs - w.startMs > best.endMs - best.startMs;
		if (!best || isCloser || isTiedButLonger) {
			best = w;
			bestDistanceMs = distanceMs;
		}
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
 * nearby candidates (two decided boundaries close together, or the ASR
 * time estimate being imprecise) can both match the same real silence
 * window, or resolve to windows out of chronological order. Left
 * unfiltered, a cursor-based build then produces a fragment whose end is
 * before its start (or overlaps the next one). Unlike the old planChunks
 * (where a dropped candidate simply wasn't used, silently), locateChunks
 * below treats anything dropped here as a real failure to report — every
 * boundary reaching this point was already decided on purpose.
 */
export function enforceMonotonicWindows<T extends { window: SilenceWindow }>(cuts: T[]): T[] {
	const accepted: T[] = [];
	let lastAcceptedEndMs = -Infinity;
	for (const cut of cuts) {
		// Strictly greater, not just non-overlapping: a later window that
		// starts exactly where the previous one ends still produces a
		// zero-duration fragment for the transcript text between the two
		// cuts — silently attaching that text to whichever neighbor it
		// merges into even though no audio span represents it.
		if (cut.window.startMs <= lastAcceptedEndMs) continue;
		accepted.push(cut);
		lastAcceptedEndMs = cut.window.endMs;
	}
	return accepted;
}

function clamp(v: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, v));
}

interface JointBoundary {
	/** Where the chunk before this window should end. */
	chunkEndMs: number;
	/** Where the chunk after this window should start. */
	nextStartMs: number;
}

/**
 * Resolves one internal silence window's boundary for the two chunks that
 * share it, computed jointly so they can never cross. Wide enough
 * (>= PRE_ATTACK_MS + TAIL_MS) for both adjustments in full: leaves a
 * small gap of untouched silence between the two chunks. Narrower than
 * that: splits whatever width is actually available between the two sides
 * in the same TAIL_MS:PRE_ATTACK_MS ratio as the constants themselves, so
 * both meet at exactly one point instead of overlapping.
 */
export function jointBoundary(window: SilenceWindow): JointBoundary {
	const desiredEndMs = window.startMs + TAIL_MS;
	const desiredStartMs = window.endMs - PRE_ATTACK_MS;
	if (desiredEndMs <= desiredStartMs) {
		return {
			chunkEndMs: clamp(desiredEndMs, window.startMs, window.endMs),
			nextStartMs: clamp(desiredStartMs, window.startMs, window.endMs)
		};
	}
	const width = window.endMs - window.startMs;
	const boundary = window.startMs + width * (TAIL_MS / (TAIL_MS + PRE_ATTACK_MS));
	return { chunkEndMs: boundary, nextStartMs: boundary };
}

export interface ChunkPlanEntry {
	text: string;
}

export interface LocateChunksResult {
	ok: boolean;
	/** Human-readable, one per unresolvable boundary — each names what to do (merge the two affected chunks in chunk_plan.json and re-run). Empty when ok. */
	failures: string[];
	/** Empty when !ok — a partial result would be more misleading than none, since every boundary in the plan was equally intentional. */
	chunks: PlannedChunk[];
}

/**
 * Takes chunk groupings already decided from the transcript's meaning
 * (chunk_plan.json, produced as a scaffold by plan-chunks.ts and then
 * grouped/enriched by hand) and finds where each one actually falls in
 * the real audio. No grouping decision happens here — only location.
 *
 * Every INTERNAL boundary (between two consecutive planned chunks) is
 * resolved the same way the old planChunks's sentence candidates were:
 * estimate its time via the ASR spine (charTimings preferred over the
 * coarser whisperSegments when available — see buildAsrSpine, and the
 * correspondingly tighter search margin used with it), then require a
 * real nearby silence window to cut cleanly on, trimmed with
 * the same PRE_ATTACK_MS/TAIL_MS via jointBoundary. Unlike the old
 * design, a boundary that can't find a real silence window nearby is
 * NOT silently dropped — it's reported as a failure, since every
 * boundary here was put there on purpose by whoever grouped the plan.
 * The expected recovery is editing chunk_plan.json to merge the two
 * chunks that boundary would have separated, then re-running — not
 * forcing a cut with nothing real to anchor it to (verify.ts's attack
 * check would catch that anyway).
 */
export function locateChunks(
	plan: ChunkPlanEntry[],
	rawTranscript: string,
	charTimings: WhisperSegment[],
	whisperSegments: WhisperSegment[],
	silences: SilenceWindow[],
	durationMs: number
): LocateChunksResult {
	const transcript = normalizeMarkWidth(rawTranscript);

	if (plan.length === 0) {
		return { ok: false, failures: ['chunk_plan.json has zero planned chunks.'], chunks: [] };
	}
	// A manually-edited chunk_plan.json can leave a merged-away entry behind
	// as { text: "", ... } — the reconstruction check below wouldn't catch
	// this on its own (an empty string still concatenates correctly), so a
	// zero-duration, empty-transcript chunk could otherwise reach cutting
	// and publishing. Found in code review 2026-08-24.
	const emptyEntries = plan.filter((entry) => entry.text.trim() === '');
	if (emptyEntries.length > 0) {
		return {
			ok: false,
			failures: [
				`${emptyEntries.length} chunk_plan.json entr${emptyEntries.length === 1 ? 'y has' : 'ies have'} empty "text" — remove the leftover entr${emptyEntries.length === 1 ? 'y' : 'ies'} (likely left behind by a merge) and re-run.`
			],
			chunks: []
		};
	}

	let cursor = 0;
	const ranges = plan.map((entry) => {
		const text = normalizeMarkWidth(entry.text);
		const charStart = cursor;
		cursor += text.length;
		return { text, charStart, charEnd: cursor };
	});

	const reconstructed = ranges.map((r) => r.text).join('');
	if (reconstructed !== transcript) {
		return {
			ok: false,
			failures: [
				// "Exactly" here means after width-normalization on both sides
				// (this reconstruction check compares `ranges` — already
				// normalizeMarkWidth'd above — against `transcript`, likewise
				// normalized), not literal byte-identity with the raw
				// transcript.json field. A scaffold entry that still has an
				// un-normalized half-width mark, or one an operator typed by
				// hand, is fine — it's dropped, reordered, or reworded content
				// this check exists to catch. Said "word-for-word" without
				// that qualifier before code review 2026-08-24, which reads as
				// stricter than the real contract and could send an operator
				// hunting for a punctuation-width difference that was never
				// the actual problem.
				'Planned chunk texts do not reconstruct transcript.json\'s "transcript" field (after width-normalization) — a chunk was edited, reordered, or had text dropped while grouping. Fix chunk_plan.json so its texts concatenate back to the same content, then re-run.'
			],
			chunks: []
		};
	}

	const usingCharTimings = charTimings.length > 0;
	const spine = usingCharTimings ? buildAsrSpine(charTimings) : buildAsrSpine(whisperSegments);
	const transcriptSpineLength = spineLength(transcript);
	const marginMs = usingCharTimings
		? CHAR_TIMING_BOUNDARY_SEARCH_MARGIN_MS
		: COARSE_BOUNDARY_SEARCH_MARGIN_MS;

	const internalCharIndices = ranges.slice(0, -1).map((r) => r.charEnd);
	const resolved = internalCharIndices.map((charIndex) => {
		const expected = estimateTimeMs(
			charIndex,
			transcript,
			spine,
			transcriptSpineLength,
			durationMs
		);
		return { charIndex, window: findBestSilence(expected, silences, 0, durationMs, marginMs) };
	});

	const failures: string[] = [];
	for (const r of resolved) {
		if (r.window !== null) continue;
		const before = transcript.slice(Math.max(0, r.charIndex - 12), r.charIndex);
		const after = transcript.slice(r.charIndex, r.charIndex + 12);
		failures.push(
			`No real pause found near the boundary between "...${before}" and "${after}..." — merge these two chunks in chunk_plan.json (there's no clean audio cut point there) and re-run.`
		);
	}

	const resolvedWithWindow = resolved.filter(
		(r): r is { charIndex: number; window: SilenceWindow } => r.window !== null
	);
	const monotonic = enforceMonotonicWindows(resolvedWithWindow);
	if (monotonic.length < resolvedWithWindow.length) {
		const monotonicSet = new Set(monotonic);
		for (const r of resolvedWithWindow) {
			if (monotonicSet.has(r)) continue;
			const before = transcript.slice(Math.max(0, r.charIndex - 12), r.charIndex);
			failures.push(
				`The boundary right after "...${before}" resolves to the same (or an out-of-order) real pause as a neighboring boundary — the audio doesn't have two distinct gaps there. Merge the affected chunks in chunk_plan.json and re-run.`
			);
		}
	}

	if (failures.length > 0) {
		return { ok: false, failures, chunks: [] };
	}

	const windows = monotonic.map((m) => m.window);
	const jointBoundaryCache = new Map<SilenceWindow, JointBoundary>();
	function cachedJointBoundary(window: SilenceWindow): JointBoundary {
		const cached = jointBoundaryCache.get(window);
		if (cached) return cached;
		const result = jointBoundary(window);
		jointBoundaryCache.set(window, result);
		return result;
	}

	const chunks: PlannedChunk[] = ranges.map((r, i) => {
		const leadingWindow = i === 0 ? null : windows[i - 1];
		const trailingWindow = i === ranges.length - 1 ? null : windows[i];
		const startMs = leadingWindow ? cachedJointBoundary(leadingWindow).nextStartMs : 0;
		const endMs = trailingWindow ? cachedJointBoundary(trailingWindow).chunkEndMs : durationMs;
		return { startMs, durationMs: Math.max(endMs - startMs, 1), transcript: r.text };
	});

	return { ok: true, failures: [], chunks };
}
