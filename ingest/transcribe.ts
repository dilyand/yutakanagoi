import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

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

/** One of whisper's own segment boundaries — timing is kept only as a diagnostic; nothing in this pipeline locates a cut against it anymore. */
export interface WhisperSegment {
	startMs: number;
	endMs: number;
	text: string;
}

export interface TranscribeResult {
	/** Full concatenated transcript, as whisper produced it — unpunctuated in whisper's usual style, no sentence-final marks to speak of. Japanese has no inter-word spacing, so segments are joined directly. */
	text: string;
	segments: WhisperSegment[];
}

/**
 * Runs whisper-cli against a 16k mono analysis wav (see audio-tools.ts's
 * toAnalysisWav — whisper-cli doesn't accept m4a directly, only flac/mp3/
 * ogg/wav) and returns its segments.
 *
 * No `-dtw`/`-nfa` here (unlike the pre-3.1.0 version of this function) —
 * those existed solely to get precise per-token timestamps for locating a
 * chunk-cut boundary in the audio, which no longer happens now that
 * ingest publishes a whole recording as one drill item. Dropping them also
 * removes a real landmine: `-dtw <preset>` silently returned unusable
 * timestamps (t_dtw = -1, no error) unless paired with `-nfa`, and the
 * preset string was model-specific and undocumented anywhere but the
 * compiled binary's `strings` output.
 */
export function transcribeWav(wavPath: string, opts?: { modelPath?: string }): TranscribeResult {
	const modelPath = opts?.modelPath ?? process.env[WHISPER_MODEL_ENV] ?? DEFAULT_MODEL_PATH;
	const workDir = mkdtempSync(path.join(tmpdir(), 'shadowing-whisper-'));
	const outputBase = path.join(workDir, 'transcript');
	try {
		const result = spawnSync(
			'whisper-cli',
			['-m', modelPath, '-f', wavPath, '-l', 'ja', '-oj', '-of', outputBase, '-np'],
			{ encoding: 'utf8' }
		);
		if (result.status !== 0) {
			throw new Error(`whisper-cli failed for ${wavPath}:\n${result.stderr}`);
		}
		const raw = readFileSync(`${outputBase}.json`, 'utf8');
		const parsed: WhisperJson = JSON.parse(raw);
		const segments: WhisperSegment[] = parsed.transcription.map((s) => ({
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
	} finally {
		rmSync(workDir, { recursive: true, force: true });
	}
}
