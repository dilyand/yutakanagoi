import { spawnSync } from 'node:child_process';

/**
 * ffmpeg/ffprobe primitives for the ingest pipeline. All shelling out uses
 * execFile-style argument arrays (spawnSync with an args array, never a
 * shell string) — audio filenames and paths here can come from
 * user-supplied files, so string interpolation into a shell command is not
 * an option.
 */

export const SAMPLE_RATE = 16_000;

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

/** Converts any ffmpeg-readable input to a 16k mono analysis wav (whisper-cli doesn't accept m4a directly, only flac/mp3/ogg/wav). */
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
 * Transcodes any ffmpeg-readable input to AAC-in-m4a — a normalized
 * playback copy, separate from the archival original ingest:publish also
 * uploads. Ingest accepts whatever container/codec ffmpeg can read (the
 * source could be m4a/mp3/wav/ogg, or something else entirely), but not
 * every one of those decodes in every browser this app supports (Safari,
 * notably, has no Ogg/Vorbis support at all) — publishing the raw upload
 * as-is can succeed and then fail silently in the drill. AAC-in-m4a is
 * universally supported, so this is run unconditionally regardless of the
 * source's own format, the same way the pre-3.1.0 chunk-cutting pipeline's
 * per-chunk encode step always did.
 */
export function transcodeForPlayback(input: string, outputM4a: string): void {
	run('ffmpeg', [
		'-y',
		'-hide_banner',
		'-loglevel',
		'error',
		'-i',
		input,
		'-c:a',
		'aac',
		'-b:a',
		'128k',
		outputM4a
	]);
}
