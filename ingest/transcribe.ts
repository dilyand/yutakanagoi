import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { WhisperSegment } from './chunk-planner.ts';

/**
 * whisper-cli wrapper. Model path defaults to where the feasibility work
 * downloaded it (`~/whisper-models/ggml-large-v3-turbo.bin`); override with
 * `WHISPER_MODEL_PATH` if it lives elsewhere.
 */
const WHISPER_MODEL_ENV = 'WHISPER_MODEL_PATH';
const DEFAULT_MODEL_PATH = path.join(
	process.env.HOME ?? '',
	'whisper-models',
	'ggml-large-v3-turbo.bin'
);

interface WhisperJsonSegment {
	offsets: { from: number; to: number };
	text: string;
}

interface WhisperJson {
	transcription: WhisperJsonSegment[];
}

export interface TranscribeResult {
	/** Full concatenated transcript, as whisper produced it — unpunctuated in whisper's usual style, no sentence-final marks to speak of. Japanese has no inter-word spacing, so segments are joined directly. */
	text: string;
	segments: WhisperSegment[];
}

/**
 * Runs whisper-cli against a 16k mono analysis wav (see audio-tools.ts's
 * toAnalysisWav — whisper-cli doesn't accept m4a directly, only flac/mp3/
 * ogg/wav) and returns its segment timings.
 *
 * `--dtw large.v3.turbo --no-flash-attn` is hardcoded and MUST stay
 * paired: `-dtw <preset>` silently returns unusable token-level timestamps
 * (t_dtw = -1, no error) unless `--no-flash-attn` is also passed — flash
 * attention discards the intermediate cross-attention data DTW alignment
 * needs. `large.v3.turbo` (three dot-separated segments) is the correct
 * preset string for the ggml-large-v3-turbo model specifically — found via
 * `strings` on the compiled binary during the feasibility work, since a
 * wrong preset name only errors with "unknown DTW preset" rather than
 * listing the valid options.
 */
function runWhisperCli(
	wavPath: string,
	modelPath: string,
	extraArgs: string[]
): WhisperJsonSegment[] {
	const workDir = mkdtempSync(path.join(tmpdir(), 'shadowing-whisper-'));
	const outputBase = path.join(workDir, 'transcript');
	try {
		const result = spawnSync(
			'whisper-cli',
			[
				'-m',
				modelPath,
				'-f',
				wavPath,
				'-l',
				'ja',
				'-dtw',
				'large.v3.turbo',
				'-nfa',
				'-oj',
				'-of',
				outputBase,
				'-np',
				...extraArgs
			],
			{ encoding: 'utf8' }
		);
		if (result.status !== 0) {
			throw new Error(`whisper-cli failed for ${wavPath}:\n${result.stderr}`);
		}
		const raw = readFileSync(`${outputBase}.json`, 'utf8');
		const parsed: WhisperJson = JSON.parse(raw);
		return parsed.transcription;
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
}

export function transcribeWav(wavPath: string, opts?: { modelPath?: string }): TranscribeResult {
	const modelPath = opts?.modelPath ?? process.env[WHISPER_MODEL_ENV] ?? DEFAULT_MODEL_PATH;
	const raw = runWhisperCli(wavPath, modelPath, []);
	const segments: WhisperSegment[] = raw.map((s) => ({
		startMs: s.offsets.from,
		endMs: s.offsets.to,
		text: s.text.trim()
	}));
	return {
		text: segments
			.map((s) => s.text)
			.join('')
			.trim(),
		segments
	};
}

/**
 * Same whisper-cli pass, but with `-ml 1` (max segment length 1 char) —
 * this is what actually surfaces the per-token DTW alignment `-dtw`
 * already computes internally: without `-ml 1`, that alignment only ever
 * shows up as ordinary multi-second segment boundaries (still refined by
 * DTW, but only at the segment level whisper's own VAD chose). With it,
 * every output "segment" is ~1 character, so its offsets ARE real
 * per-character audio timing — confirmed on real data during design work
 * (e.g. 大 at 7210-7800ms, 丈夫 at 7800-9240ms, both individually
 * resolved). This is a second, separate whisper-cli invocation (roughly
 * doubling transcribe time) rather than a flag added to the call above,
 * because `-ml 1` fragments the JSON's normal multi-sentence segments —
 * transcribeWav's own segments stay coarse/readable on purpose, for
 * debugging and as a fallback spine for the whole recording if this pass
 * ever comes back sparse or with a real gap in it (see
 * hasSufficientCharTimingCoverage in chunk-planner.ts — the fallback is
 * all-or-nothing per recording, not per missing span: there's no reliable
 * way to tell "estimate near a sparse patch" from "genuinely precise"
 * once one bad interpolation has blended into the shared spine).
 */
export function transcribeWavCharTimings(
	wavPath: string,
	opts?: { modelPath?: string }
): WhisperSegment[] {
	const modelPath = opts?.modelPath ?? process.env[WHISPER_MODEL_ENV] ?? DEFAULT_MODEL_PATH;
	const raw = runWhisperCli(wavPath, modelPath, ['-ml', '1']);
	return raw
		.map((s) => ({ startMs: s.offsets.from, endMs: s.offsets.to, text: s.text.trim() }))
		.filter((s) => s.text.length > 0);
}
