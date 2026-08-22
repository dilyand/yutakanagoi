import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, requireString } from '../args.ts';
import { cutChunk, applyFades, detectSilences } from '../audio-tools.ts';
import { planChunks, type WhisperSegment } from '../chunk-planner.ts';
import { verifyChunk, verifyDistinct, verifyCoverage } from '../verify.ts';

const USAGE = `Usage: npm run ingest:cut -- --slug <slug> --user <username>

Reads ingest/work/<user>/<slug>/transcript.json, plans chunk boundaries,
cuts and fades each chunk, verifies every one (content match, no cut on an
attack, fades applied, distinctness, coverage), and writes chunks.json with
"kana"/"translation" left blank for the next step. On a verification
failure, chunks.json is still written (with "verified": false and
"verifyFailures" on the affected chunk(s)) for inspection, and the command
exits nonzero rather than proceeding to the next step.`;

const FADE_MS = 30;

const args = parseArgs(process.argv.slice(2));
const slug = requireString(args, 'slug', USAGE);
const username = requireString(args, 'user', USAGE);

const workDir = path.join(import.meta.dirname, '..', 'work', username, slug);
const transcriptPath = path.join(workDir, 'transcript.json');
if (!existsSync(transcriptPath)) {
	console.error(`No transcript.json at ${transcriptPath} — run ingest:transcribe first.`);
	process.exit(1);
}

interface TranscriptManifest {
	slug: string;
	user: string;
	sourceAudioPath: string;
	durationMs: number;
	transcript: string;
	transcriptSource: 'supplied' | 'asr';
	whisperSegments: WhisperSegment[];
}

const manifest: TranscriptManifest = JSON.parse(readFileSync(transcriptPath, 'utf8'));

if (manifest.transcriptSource === 'asr' && !/[。！？]/.test(manifest.transcript)) {
	console.error(
		'transcript.json has no sentence-final punctuation (。！？) — this looks like raw, unedited whisper output. Restore punctuation in the "transcript" field before cutting (see PROMPT.md); cutting an unpunctuated transcript produces one giant unplanned chunk at best.'
	);
	process.exit(1);
}

const sourceWavPath = path.join(workDir, 'source.wav');
console.log('Detecting silences...');
const silences = detectSilences(sourceWavPath);

const plan = planChunks({
	transcript: manifest.transcript,
	durationMs: manifest.durationMs,
	whisperSegments: manifest.whisperSegments,
	silences
});
console.log(`Planned ${plan.length} chunk(s).`);

interface ChunkManifestEntry {
	index: number;
	audioFile: string;
	startMs: number;
	durationMs: number;
	transcript: string;
	kana: string;
	translation: string;
	verified: boolean;
	verifyFailures: string[];
}

const chunkEntries: ChunkManifestEntry[] = [];
const finalPaths: string[] = [];
let anyFailed = false;

plan.forEach((chunk, i) => {
	const n = String(i + 1).padStart(2, '0');
	const preFadeWav = path.join(workDir, `cut-${n}.wav`);
	const audioFile = `chunk-${n}.m4a`;
	const finalPath = path.join(workDir, audioFile);

	cutChunk(sourceWavPath, chunk.startMs, chunk.durationMs, preFadeWav);
	applyFades(preFadeWav, finalPath, FADE_MS);
	finalPaths.push(finalPath);

	const result = verifyChunk({
		preFadeWav,
		finalAudioPath: finalPath,
		sourceWav: sourceWavPath,
		startMs: chunk.startMs,
		durationMs: chunk.durationMs,
		fadeMs: FADE_MS,
		isLastChunk: i === plan.length - 1
	});

	console.log(
		`  chunk ${n}: ${result.ok ? 'OK' : 'FAIL'} [${chunk.startMs}ms +${chunk.durationMs}ms] ${chunk.transcript}`
	);
	if (!result.ok) {
		anyFailed = true;
		for (const f of result.failures) console.log(`    - ${f}`);
	}

	chunkEntries.push({
		index: i + 1,
		audioFile,
		startMs: chunk.startMs,
		durationMs: chunk.durationMs,
		transcript: chunk.transcript,
		kana: '',
		translation: '',
		verified: result.ok,
		verifyFailures: result.failures
	});
});

const distinct = verifyDistinct(finalPaths);
if (!distinct.ok) {
	anyFailed = true;
	console.log('Distinctness check failed:');
	for (const f of distinct.failures) console.log(`  - ${f}`);
}

const coverage = verifyCoverage(plan, manifest.durationMs);
if (!coverage.ok) {
	anyFailed = true;
	console.log('Coverage check failed:');
	for (const f of coverage.failures) console.log(`  - ${f}`);
}

interface ChunkManifest {
	slug: string;
	user: string;
	sourceAudioPath: string;
	durationMs: number;
	transcript: string;
	transcriptSource: 'supplied' | 'asr';
	recordedOn: string | null;
	chunks: ChunkManifestEntry[];
}

const chunkManifest: ChunkManifest = {
	slug: manifest.slug,
	user: manifest.user,
	sourceAudioPath: manifest.sourceAudioPath,
	durationMs: manifest.durationMs,
	transcript: manifest.transcript,
	transcriptSource: manifest.transcriptSource,
	recordedOn: null,
	chunks: chunkEntries
};
writeFileSync(path.join(workDir, 'chunks.json'), JSON.stringify(chunkManifest, null, 2));
console.log(`\nWrote ${path.join(workDir, 'chunks.json')}`);

if (anyFailed) {
	console.error(
		"\nOne or more chunks failed verification (see above) — chunks.json was written for inspection, but ingest:publish will refuse to run until every chunk verifies clean. Re-tune and re-run ingest:cut (e.g. adjust the transcript's punctuation, or retune chunk-planner.ts's constants) rather than editing chunks.json by hand to force it through."
	);
	process.exit(1);
}

console.log(
	'\nAll chunks verified. Next: fill "kana" and "translation" for each chunk in chunks.json, then run ingest:publish. See PROMPT.md.'
);
