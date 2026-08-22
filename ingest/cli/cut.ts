import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, requireString, requireSafePathComponent } from '../args.ts';
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
// Both values are used as filesystem path components below — validated
// beyond just non-empty so a value like "../other" or ".." can't navigate
// workDir outside the intended ingest/work/<user>/<slug> directory.
const slug = requireSafePathComponent(requireString(args, 'slug', USAGE), 'slug');
const username = requireSafePathComponent(requireString(args, 'user', USAGE), 'username');

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

// Source-independent: a *supplied* transcript is only trimmed and
// similarity-checked in ingest:transcribe, never validated for
// punctuation — it can arrive unpunctuated just as easily as raw ASR
// output can, and hits exactly the same failure (one giant unplanned
// chunk) if it does. This used to only check transcriptSource === 'asr',
// letting an unpunctuated supplied transcript bypass the guard entirely.
if (!/[。！？]/.test(manifest.transcript)) {
	console.error(
		'transcript.json has no sentence-final punctuation (。！？). Restore punctuation in the "transcript" field before cutting (see PROMPT.md); cutting an unpunctuated transcript produces one giant unplanned chunk at best.'
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
// Staged chunk audio (path.join(workDir, `.tmp-${audioFile}`) below), not
// each chunk's own final chunk-NN.m4a name, until every chunk in the plan
// has been cut/faded/verified with nothing throwing along the way. Without
// this, cutChunk/applyFades throwing partway through the loop (an ffmpeg
// crash on one chunk) left whichever earlier chunk-NN.m4a files the loop
// had already reached fully overwritten, while the crash meant chunks.json
// below never got rewritten — leaving the *previous* run's manifest (still
// claiming those chunk files' old, now-incorrect transcript/verified
// status) paired with audio that no longer matches it. ingest:publish
// trusts chunks.json outright and never re-verifies audio bytes against
// it, so that mismatch would publish silently. Same reasoning, and same
// commit point, as ingest:transcribe's staged source/stale-chunks
// invalidation (see its comments).
const stagedToFinal: { staged: string; final: string }[] = [];
let anyFailed = false;

plan.forEach((chunk, i) => {
	const n = String(i + 1).padStart(2, '0');
	const preFadeWav = path.join(workDir, `cut-${n}.wav`);
	const audioFile = `chunk-${n}.m4a`;
	const stagedPath = path.join(workDir, `.tmp-${audioFile}`);
	const finalPath = path.join(workDir, audioFile);

	cutChunk(sourceWavPath, chunk.startMs, chunk.durationMs, preFadeWav);
	applyFades(preFadeWav, stagedPath, FADE_MS);
	stagedToFinal.push({ staged: stagedPath, final: finalPath });

	const result = verifyChunk({
		preFadeWav,
		finalAudioPath: stagedPath,
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

const recordingVerifyFailures: string[] = [];

const distinct = verifyDistinct(stagedToFinal.map((p) => p.staged));
if (!distinct.ok) {
	anyFailed = true;
	recordingVerifyFailures.push(...distinct.failures);
	console.log('Distinctness check failed:');
	for (const f of distinct.failures) console.log(`  - ${f}`);
}

const coverage = verifyCoverage(plan, manifest.durationMs);
if (!coverage.ok) {
	anyFailed = true;
	recordingVerifyFailures.push(...coverage.failures);
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
	// Recording-wide checks (distinctness across all chunks, coverage of
	// the whole timeline) aren't per-chunk — persisted here rather than
	// only printed to the console, so ingest:publish's verification gate
	// (which only reads this file, never a prior command's console output
	// or exit code) can actually see a failure here too. Previously these
	// checks correctly made ingest:cut itself exit nonzero, but a chunk
	// could still show "verified": true individually while the recording
	// as a whole had a real problem — publish's gate never looked at this.
	recordingVerifyFailures: string[];
	chunks: ChunkManifestEntry[];
}

// Every chunk in the plan has been cut/faded/verified with nothing
// throwing — safe to commit the staged audio into its final chunk-NN.m4a
// names, and only then write chunks.json. This runs regardless of
// anyFailed (a verification failure still writes chunks.json "for
// inspection", by design — see the USAGE string above); what this staging
// specifically prevents is an earlier THROWN exception (an ffmpeg crash)
// leaving some chunk-NN.m4a files overwritten while chunks.json still
// describes the previous run's chunks, which is what actually breaks
// ingest:publish's trust in the manifest.
for (const { staged, final } of stagedToFinal) renameSync(staged, final);

const chunkManifest: ChunkManifest = {
	slug: manifest.slug,
	user: manifest.user,
	sourceAudioPath: manifest.sourceAudioPath,
	durationMs: manifest.durationMs,
	transcript: manifest.transcript,
	transcriptSource: manifest.transcriptSource,
	recordedOn: null,
	recordingVerifyFailures,
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
