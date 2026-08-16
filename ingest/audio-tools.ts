import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * ffmpeg/ffprobe primitives for the ingest pipeline. Every function here
 * exists because a naive version of it produced a real, silent bug during
 * the manual feasibility work (see notes/shadowing-practice-design.md) —
 * each gotcha gets exactly one home so a future edit can't reintroduce it
 * in a second place. All shelling out uses execFile-style argument arrays
 * (spawnSync with an args array, never a shell string) — audio filenames
 * and paths here can come from user-supplied files, so string
 * interpolation into a shell command is not an option.
 */

export const SAMPLE_RATE = 16_000;

interface SilenceWindow {
	startMs: number;
	endMs: number;
}

function run(cmd: string, args: string[]): void {
	const result = spawnSync(cmd, args, { encoding: 'utf8' });
	if (result.status !== 0) {
		throw new Error(`${cmd} ${args.join(' ')} failed:\n${result.stderr}`);
	}
}

/** Duration of any ffprobe-readable file, in milliseconds. */
export function probeDurationMs(path: string): number {
	const result = spawnSync(
		'ffprobe',
		['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
		{ encoding: 'utf8' }
	);
	if (result.status !== 0) {
		throw new Error(`ffprobe failed for ${path}: ${result.stderr}`);
	}
	const seconds = parseFloat(result.stdout.trim());
	if (!Number.isFinite(seconds)) {
		throw new Error(`ffprobe returned a non-numeric duration for ${path}: ${result.stdout}`);
	}
	return Math.round(seconds * 1000);
}

/** Converts any ffmpeg-readable input to a 16k mono analysis wav. */
export function toAnalysisWav(input: string, output: string): void {
	run('ffmpeg', [
		'-y',
		'-hide_banner',
		'-loglevel',
		'error',
		'-i',
		input,
		'-ac',
		'1',
		'-ar',
		String(SAMPLE_RATE),
		output
	]);
}

/**
 * Trims a chunk out of a source wav. `-ss` goes BEFORE `-i` (input-side
 * seeking) and `-t` (not `-to`) is used for the duration — both found
 * 2026-08-13: with `-ss`/`-to` given as OUTPUT options (after `-i`) plus
 * `-c copy`, ffmpeg silently snapped to the wrong cut position on real
 * source audio — no error, no warning, a plausible-looking output file,
 * just wrong content by anywhere from ~20ms to 70ms+ depending on the cut
 * point. Confirmed only by direct waveform/content comparison against the
 * source (see verifyContentMatch in verify.ts) — matching duration or file
 * size was not sufficient evidence a trim landed correctly. Both changes
 * independently fixed it in testing; using them together is the safe
 * combination this function encodes.
 */
export function cutChunk(
	srcWav: string,
	startMs: number,
	durationMs: number,
	outWav: string
): void {
	run('ffmpeg', [
		'-y',
		'-hide_banner',
		'-loglevel',
		'error',
		'-ss',
		(startMs / 1000).toFixed(6),
		'-i',
		srcWav,
		'-t',
		(durationMs / 1000).toFixed(6),
		'-c',
		'copy',
		outWav
	]);
}

/**
 * Applies fade in/out and encodes to the final m4a — ALWAYS as a genuinely
 * separate second ffmpeg pass from cutChunk above, never combined with the
 * trim in one command. Found 2026-08-13: a fade combined with output-side
 * `-ss`/`-to` trimming silently failed to apply at all on at least one real
 * chunk — the resulting file was byte-identical to a no-fade test file
 * despite looking plausible (reasonable size, not corrupted). The root
 * cause was never fully diagnosed; this two-pass shape (trim to an
 * intermediate wav with `-c copy` first, then a second, independent ffmpeg
 * invocation applies the fades and encodes) is the documented, verified
 * workaround.
 */
export function applyFades(inWav: string, outM4a: string, fadeMs: number): void {
	const durationMs = probeDurationMs(inWav);
	const fadeS = (fadeMs / 1000).toFixed(6);
	const outStartS = Math.max(0, (durationMs - fadeMs) / 1000).toFixed(6);
	run('ffmpeg', [
		'-y',
		'-hide_banner',
		'-loglevel',
		'error',
		'-i',
		inWav,
		'-af',
		`afade=t=in:d=${fadeS},afade=t=out:st=${outStartS}:d=${fadeS}`,
		'-c:a',
		'aac',
		'-b:a',
		'128k',
		outM4a
	]);
}

// -30dB / d=0.15: validated 2026-08-16 against all three real recordings
// from the feasibility work (test-aya, hellotalk-260812-0944-{1,2}) —
// every one of the 13 chunks these settings' silence windows produced
// passed content-match verification (see verify.ts) with a perfect
// correlation of 1.000 and 0.0ms lag. The design notes flagged this
// combination as untested and possibly too permissive mid-clip / too
// aggressive at a clip's start; real testing didn't reproduce either
// failure on these three samples, but they remain the only ones tested —
// revisit if a differently-recorded source (background noise, mic
// quality, room tone) starts producing bad boundaries.
export const DEFAULT_SILENCE_NOISE_DB = -30;
export const DEFAULT_SILENCE_MIN_DURATION_S = 0.15;

/**
 * Runs ffmpeg's silencedetect filter and parses the `silence_start`/
 * `silence_end` pairs it writes to stderr (there is no structured output
 * mode). A trailing `silence_start` with no matching `silence_end` — real
 * silence running to EOF — is dropped by the min-length zip below rather
 * than treated as an error; the chunk planner never needs an unterminated
 * window as a cut candidate.
 */
export function detectSilences(
	wav: string,
	opts: { noiseDb: number; minDurationS: number } = {
		noiseDb: DEFAULT_SILENCE_NOISE_DB,
		minDurationS: DEFAULT_SILENCE_MIN_DURATION_S
	}
): SilenceWindow[] {
	const result = spawnSync(
		'ffmpeg',
		[
			'-hide_banner',
			'-i',
			wav,
			'-af',
			`silencedetect=noise=${opts.noiseDb}dB:d=${opts.minDurationS}`,
			'-f',
			'null',
			'-'
		],
		{ encoding: 'utf8', maxBuffer: 1024 * 1024 * 64 }
	);
	const stderr = result.stderr ?? '';

	const starts: number[] = [];
	const startRe = /silence_start:\s*(-?[\d.]+)/g;
	let m: RegExpExecArray | null;
	while ((m = startRe.exec(stderr))) starts.push(parseFloat(m[1]) * 1000);

	const ends: number[] = [];
	const endRe = /silence_end:\s*(-?[\d.]+)/g;
	while ((m = endRe.exec(stderr))) ends.push(parseFloat(m[1]) * 1000);

	const count = Math.min(starts.length, ends.length);
	const windows: SilenceWindow[] = [];
	for (let i = 0; i < count; i++) {
		windows.push({ startMs: starts[i], endMs: ends[i] });
	}
	return windows;
}

/**
 * Decodes (a region of) a wav to raw mono 16k f32 PCM samples. `startMs`/
 * `durationMs` use the same input-side `-ss`-before-`-i` seeking as
 * cutChunk — accurate here because the source is always already a PCM wav,
 * not a compressed format.
 */
export function decodeF32(
	wav: string,
	opts?: { startMs?: number; durationMs?: number }
): Float32Array {
	const args = ['-hide_banner', '-loglevel', 'error'];
	if (opts?.startMs !== undefined) {
		args.push('-ss', (Math.max(0, opts.startMs) / 1000).toFixed(6));
	}
	args.push('-i', wav);
	if (opts?.durationMs !== undefined) {
		args.push('-t', (opts.durationMs / 1000).toFixed(6));
	}
	args.push('-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1');

	const result = spawnSync('ffmpeg', args, { maxBuffer: 1024 * 1024 * 256 });
	if (result.status !== 0) {
		throw new Error(`ffmpeg decode failed for ${wav}: ${result.stderr?.toString()}`);
	}
	// Buffer.from copies into a freshly-allocated, 4-byte-aligned
	// ArrayBuffer — spawnSync's stdout buffer's own byteOffset isn't
	// guaranteed aligned for a Float32Array view.
	const aligned = Buffer.from(result.stdout);
	return new Float32Array(aligned.buffer, aligned.byteOffset, Math.floor(aligned.length / 4));
}

/**
 * RMS level in dB for a short window starting at `atMs`. Used both to find
 * a chunk's cut point landing in real quiet (verify.ts's no-cut-on-an-
 * attack check) and to confirm a fade actually ramped down toward silence
 * (verify.ts's fade-applied check) — the 250ms windows silencedetect uses
 * for boundary detection are too coarse to see a consonant attack this
 * short, which is why this operates on a caller-chosen, typically ≤10ms
 * window instead.
 */
export function rmsDbAt(wav: string, atMs: number, windowMs: number): number {
	const samples = decodeF32(wav, { startMs: atMs, durationMs: windowMs });
	if (samples.length === 0) return -120;
	let sumSq = 0;
	for (let i = 0; i < samples.length; i++) sumSq += samples[i] * samples[i];
	const rms = Math.sqrt(sumSq / samples.length);
	return rms <= 0 ? -120 : 20 * Math.log10(rms);
}

/** sha256 of a file's raw bytes — used to confirm two "different" chunks aren't byte-identical. */
export function contentHashOfFile(path: string): string {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/**
 * Normalized cross-correlation of `needle` against `haystack`, searching
 * every valid offset. `expectedOffsetSamples` is where `needle` should
 * start within `haystack` if the cut landed exactly right (the caller pads
 * `haystack` by the max lag it wants to tolerate on each side of that
 * point) — the returned `lagMs` is signed, relative to that expectation.
 *
 * This is the check that actually catches the `-ss`/`-to` snap bug
 * documented on cutChunk above: matching duration and file size did not
 * catch it in testing, only a direct content comparison did. Deliberately
 * a plain O(needle × offsets) direct search rather than an FFT-based one —
 * at the ±250ms max lag this pipeline uses, that's a few seconds per
 * chunk, which is fine for a batch ingestion tool and easier to trust the
 * correctness of than a hand-rolled FFT.
 */
export function crossCorrelate(
	needle: Float32Array,
	haystack: Float32Array,
	expectedOffsetSamples: number
): { lagMs: number; correlation: number } {
	if (haystack.length < needle.length) {
		throw new Error('crossCorrelate: haystack shorter than needle');
	}
	const maxOffset = haystack.length - needle.length;
	let bestOffset = 0;
	let bestScore = -Infinity;
	for (let offset = 0; offset <= maxOffset; offset++) {
		let dot = 0;
		let needleEnergy = 0;
		let haystackEnergy = 0;
		for (let i = 0; i < needle.length; i++) {
			const n = needle[i];
			const h = haystack[offset + i];
			dot += n * h;
			needleEnergy += n * n;
			haystackEnergy += h * h;
		}
		const denom = Math.sqrt(needleEnergy * haystackEnergy);
		const score = denom === 0 ? 0 : dot / denom;
		if (score > bestScore) {
			bestScore = score;
			bestOffset = offset;
		}
	}
	const lagSamples = bestOffset - expectedOffsetSamples;
	return { lagMs: (lagSamples / SAMPLE_RATE) * 1000, correlation: bestScore };
}
