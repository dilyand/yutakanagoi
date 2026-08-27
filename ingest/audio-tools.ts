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
