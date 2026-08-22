/**
 * The transcript sanitization gate: cross-checks a user-supplied transcript
 * against whisper's own independent pass. This is what caught a real ASR
 * hallucination during the feasibility work — a clause the supplied
 * transcript never had, or vice versa — text-only inference in either
 * direction alone isn't reliable; only comparing against an independent
 * transcription is.
 *
 * Three independent triggers decide `diverged`: a whole-text normalized
 * similarity score (robust whether or not the ASR side has punctuation,
 * which it often doesn't — see transcribe.ts); any supplied sentence with
 * no good match anywhere in the ASR text (a clause the human transcript
 * invented); and any ASR segment with no good match anywhere in the
 * supplied text (a clause Whisper invented — the "or vice versa" case).
 * The whole-text score alone isn't enough on a long recording — one fully
 * invented clause, in either direction, only moves the aggregate score by
 * a small fraction of the total character count, so it can hide well
 * above DIVERGENCE_THRESHOLD even though it's exactly the kind of
 * localized hallucination this gate exists to catch.
 *
 * The two localized checks are asymmetric by necessity, not oversight:
 * the supplied-side check splits on sentence-final punctuation (the
 * supplied transcript is expected to have it), while the ASR-side check
 * uses whisper's own segment boundaries instead of splitting asrText on
 * punctuation — raw ASR output routinely has none at all (see
 * transcribe.ts), so a punctuation split there would degrade to one giant
 * "sentence" spanning the whole recording, which can't localize anything.
 * Both checks are a best-effort approximation, not true alignment: each
 * span on one side is checked against every same-length window of the
 * other side's text for the best fuzzy match. All three triggers share
 * the same --accept-transcript override.
 */

const DIVERGENCE_THRESHOLD = 0.75;
const SENTENCE_MATCH_THRESHOLD = 0.6;

export interface TranscriptDiffReport {
	overallSimilarity: number;
	/** Supplied-transcript sentences with no good match anywhere in the ASR text. */
	divergentSentences: string[];
	/** ASR segments with no good match anywhere in the supplied text. */
	asrOnlySpans: string[];
	diverged: boolean;
}

function normalize(text: string): string {
	return text.replace(/[\s。、！？「」『』・,.!?]/g, '');
}

/**
 * Rolling two-row implementation — a full recording's transcript can run
 * to several thousand characters, and the straightforward
 * (a.length+1) x (b.length+1) matrix scales quadratically in memory, not
 * just time. Distance only ever needs the previous row to compute the
 * next one, so memory is linear in the shorter string (swapped to `b`).
 */
function levenshtein(a: string, b: string): number {
	if (a.length < b.length) [a, b] = [b, a];
	let prevRow = Array.from({ length: b.length + 1 }, (_, j) => j);
	for (let i = 1; i <= a.length; i++) {
		const currRow = new Array<number>(b.length + 1);
		currRow[0] = i;
		for (let j = 1; j <= b.length; j++) {
			currRow[j] =
				a[i - 1] === b[j - 1]
					? prevRow[j - 1]
					: 1 + Math.min(prevRow[j], currRow[j - 1], prevRow[j - 1]);
		}
		prevRow = currRow;
	}
	return prevRow[b.length];
}

function splitSentences(text: string): string[] {
	// Both full-width (。！？) and ASCII (.!?) sentence-final marks — a
	// supplied transcript using ordinary periods otherwise splits into one
	// giant "sentence" spanning the whole text, which degrades the
	// localized-divergence check back down to an aggregate comparison (the
	// same failure mode this per-sentence check exists to catch).
	return text
		.split(/(?<=[。！？.!?])/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/**
 * Best fuzzy match of `needle` anywhere in `haystack`, via a same-length
 * sliding window. Exported for direct regression testing — testing it only
 * indirectly through compareTranscripts risks the aggregate-similarity
 * trigger masking a bug in this function's own scan, the same
 * black-box-masking failure mode chunk-planner.ts's small pure functions
 * are exported to avoid.
 */
export function bestSubstringSimilarity(needle: string, haystack: string): number {
	if (needle.length === 0) return 1;
	if (haystack.length <= needle.length) {
		return 1 - levenshtein(needle, haystack) / Math.max(needle.length, haystack.length, 1);
	}
	let best = 0;
	const step = Math.max(1, Math.floor(needle.length / 4));
	const lastStart = haystack.length - needle.length;
	// lastStart is always evaluated even when it isn't a multiple of
	// `step` — otherwise a `for (i += step)` scan can step clean over the
	// one window that exactly matches: an exact match ending exactly at
	// haystack's end, whose start isn't step-aligned, would only ever be
	// scored via an earlier, misaligned window that scores far lower than
	// the real match — falsely flagging a real exact match as divergent.
	const starts = new Set<number>();
	for (let i = 0; i <= lastStart; i += step) starts.add(i);
	starts.add(lastStart);
	for (const i of starts) {
		const window = haystack.slice(i, i + needle.length);
		const sim = 1 - levenshtein(needle, window) / needle.length;
		if (sim > best) best = sim;
	}
	return best;
}

/**
 * `asrSegments` are whisper's own segment texts (see transcribe.ts's
 * WhisperSegment) — optional so a caller with only plain ASR text still
 * gets the whole-text and supplied-sentence checks, just not the
 * ASR-only-span one. transcribe.ts, the one real caller, always has
 * segments available and passes them.
 */
export function compareTranscripts(
	supplied: string,
	asrText: string,
	asrSegments: string[] = []
): TranscriptDiffReport {
	const normalizedSupplied = normalize(supplied);
	const normalizedAsr = normalize(asrText);
	const overallSimilarity =
		1 -
		levenshtein(normalizedSupplied, normalizedAsr) /
			Math.max(normalizedSupplied.length, normalizedAsr.length, 1);

	const divergentSentences: string[] = [];
	for (const sentence of splitSentences(supplied)) {
		const normalizedSentence = normalize(sentence);
		if (normalizedSentence.length === 0) continue;
		const sim = bestSubstringSimilarity(normalizedSentence, normalizedAsr);
		if (sim < SENTENCE_MATCH_THRESHOLD) divergentSentences.push(sentence);
	}

	const asrOnlySpans: string[] = [];
	for (const segment of asrSegments) {
		const normalizedSegment = normalize(segment);
		if (normalizedSegment.length === 0) continue;
		const sim = bestSubstringSimilarity(normalizedSegment, normalizedSupplied);
		if (sim < SENTENCE_MATCH_THRESHOLD) asrOnlySpans.push(segment);
	}

	return {
		overallSimilarity,
		divergentSentences,
		asrOnlySpans,
		diverged:
			overallSimilarity < DIVERGENCE_THRESHOLD ||
			divergentSentences.length > 0 ||
			asrOnlySpans.length > 0
	};
}
