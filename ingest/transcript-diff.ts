/**
 * The transcript sanitization gate: cross-checks a user-supplied transcript
 * against whisper's own independent pass. This is what caught a real ASR
 * hallucination during the feasibility work — a clause the supplied
 * transcript never had, or vice versa — text-only inference in either
 * direction alone isn't reliable; only comparing against an independent
 * transcription is.
 *
 * A whole-text normalized similarity score is the abort gate (robust
 * whether or not the ASR side has punctuation, which it often doesn't —
 * see transcribe.ts). Per-sentence reporting on top is a best-effort
 * approximation, not true alignment: each of the supplied transcript's own
 * sentences is checked against every same-length window of the ASR text
 * for the best fuzzy match, so a divergent sentence can be named in the
 * printed report rather than just contributing to one opaque score.
 */

const DIVERGENCE_THRESHOLD = 0.75;
const SENTENCE_MATCH_THRESHOLD = 0.6;

export interface TranscriptDiffReport {
	overallSimilarity: number;
	/** Supplied-transcript sentences with no good match anywhere in the ASR text. */
	divergentSentences: string[];
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
	return text
		.split(/(?<=[。！？])/)
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Best fuzzy match of `needle` anywhere in `haystack`, via a same-length sliding window. */
function bestSubstringSimilarity(needle: string, haystack: string): number {
	if (needle.length === 0) return 1;
	if (haystack.length <= needle.length) {
		return 1 - levenshtein(needle, haystack) / Math.max(needle.length, haystack.length, 1);
	}
	let best = 0;
	const step = Math.max(1, Math.floor(needle.length / 4));
	for (let i = 0; i + needle.length <= haystack.length; i += step) {
		const window = haystack.slice(i, i + needle.length);
		const sim = 1 - levenshtein(needle, window) / needle.length;
		if (sim > best) best = sim;
	}
	return best;
}

export function compareTranscripts(supplied: string, asrText: string): TranscriptDiffReport {
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

	return {
		overallSimilarity,
		divergentSentences,
		diverged: overallSimilarity < DIVERGENCE_THRESHOLD
	};
}
