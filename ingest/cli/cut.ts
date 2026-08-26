import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, requireString, requireSafePathComponent } from '../args.ts';
import { cutChunk, applyFades, detectSilences } from '../audio-tools.ts';
import { locateChunks, type WhisperSegment, type ChunkPlanEntry } from '../chunk-planner.ts';
import { verifyChunk, verifyDistinct, verifyCoverage } from '../verify.ts';

const USAGE = `Usage: npm run ingest:cut -- --slug <slug> --user <username>

Reads ingest/work/<user>/<slug>/transcript.json and chunk_plan.json (see
ingest:plan-chunks), locates each already-grouped chunk in the real audio,
cuts and fades it, verifies every one (content match, no cut on an attack,
fades applied, distinctness, coverage), and writes chunks.json with kana/
translation copied straight from chunk_plan.json. On a verification
failure, chunks.json is still written (with "verified": false and
"verifyFailures" on the affected chunk(s)) for inspection, and the command
exits nonzero rather than proceeding to the next step. cut.ts does not
decide chunk groupings — that's chunk_plan.json's job, done by hand — it
only locates and cuts what's already been decided.`;

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
const chunkPlanPath = path.join(workDir, 'chunk_plan.json');
if (!existsSync(chunkPlanPath)) {
	console.error(`No chunk_plan.json at ${chunkPlanPath} — run ingest:plan-chunks first.`);
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
	charTimings: WhisperSegment[];
}

interface RawChunkPlanEntry {
	text: string;
	kana: string;
	translation: string;
}

const manifest: TranscriptManifest = JSON.parse(readFileSync(transcriptPath, 'utf8'));
const rawPlan: RawChunkPlanEntry[] = JSON.parse(readFileSync(chunkPlanPath, 'utf8'));

const unenriched = rawPlan.filter((p) => p.kana.trim() === '' || p.translation.trim() === '');
if (unenriched.length > 0) {
	console.error(
		`${unenriched.length} entr${unenriched.length === 1 ? 'y' : 'ies'} in chunk_plan.json still ha${unenriched.length === 1 ? 's' : 've'} an empty "kana" or "translation" — fill those in before cutting. First: ${JSON.stringify(unenriched[0].text)}`
	);
	process.exit(1);
}

const sourceWavPath = path.join(workDir, 'source.wav');
console.log('Detecting silences...');
const silences = detectSilences(sourceWavPath);

const planEntries: ChunkPlanEntry[] = rawPlan.map((p) => ({ text: p.text }));
const located = locateChunks(
	planEntries,
	manifest.transcript,
	manifest.charTimings ?? [],
	manifest.whisperSegments,
	silences,
	manifest.durationMs
);
if (!located.ok) {
	console.error('Could not locate every planned chunk in the audio:');
	for (const f of located.failures) console.error(`  - ${f}`);
	// A prior successful cut's chunks.json is still sitting here, still
	// marked "verified": true, and no longer describes the current
	// chunk_plan.json — ingest:publish reads only chunks.json and has no
	// way to know it's stale. Same reasoning, same fix, as
	// ingest:transcribe's stale-output invalidation: remove it now rather
	// than leave a manifest that looks trustworthy but isn't. Found in
	// code review 2026-08-26.
	const chunksJsonPath = path.join(workDir, 'chunks.json');
	if (existsSync(chunksJsonPath)) {
		rmSync(chunksJsonPath);
		console.error(
			`Removed stale ${chunksJsonPath} from a previous successful cut — re-run after fixing chunk_plan.json.`
		);
	}
	process.exit(1);
}
const plan = located.chunks;
console.log(`Located ${plan.length} planned chunk(s) in the audio.`);

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
		kana: rawPlan[i].kana,
		translation: rawPlan[i].translation,
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
	// or exit code) can actually see a failure here too.
	recordingVerifyFailures: string[];
	chunks: ChunkManifestEntry[];
}

// Every chunk in the plan has been cut/faded/verified with nothing
// throwing — safe to commit. This runs regardless of anyFailed (a
// verification failure still writes chunks.json "for inspection", by
// design — see the USAGE string above); what this staging specifically
// prevents is an earlier THROWN exception (an ffmpeg crash) leaving some
// chunk-NN.m4a files overwritten while chunks.json still describes the
// previous run's chunks, which is what actually breaks ingest:publish's
// trust in the manifest.
//
// The old chunks.json is invalidated FIRST, before the rename loop below
// promotes any staged chunk audio — not after. The promotion loop is
// itself interruptible (a kill signal, a crash between any two renames):
// if the old manifest were still in place while some chunk-NN.m4a files
// have already been promoted to this new run's audio and others haven't,
// ingest:publish would trust the old (now-wrong) transcript/verified
// status for a manifest describing a mix of old and new chunk audio.
// Deleting chunks.json first means an interruption at any point from
// here through the rename loop leaves no manifest at all — publish's own
// "no chunks.json" gate catches it regardless of exactly where an
// interruption lands, the same reasoning ingest:transcribe's source
// commit uses.
const chunksJsonPath = path.join(workDir, 'chunks.json');
if (existsSync(chunksJsonPath)) rmSync(chunksJsonPath);

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
writeFileSync(chunksJsonPath, JSON.stringify(chunkManifest, null, 2));
console.log(`\nWrote ${chunksJsonPath}`);

if (anyFailed) {
	console.error(
		"\nOne or more chunks failed verification (see above) — chunks.json was written for inspection, but ingest:publish will refuse to run until every chunk verifies clean. This traces to the audio, not the grouping — chunk_plan.json's groupings already located cleanly (locateChunks succeeded) but the actual cut/fade came out wrong; re-run ingest:cut, and if it keeps failing, treat it as a real bug worth reporting rather than editing chunks.json by hand to force it through."
	);
	process.exit(1);
}

console.log('\nAll chunks verified. Next: run ingest:publish. See PROMPT.md.');
