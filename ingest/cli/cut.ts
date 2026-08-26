import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
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

// Invalidate any chunks.json from a PRIOR successful cut as the very first
// thing this run does — before even the transcript.json/chunk_plan.json
// existence guards below, not just before reading or parsing them — found
// in code review 2026-08-26 across three rounds: the first fix only
// cleared it in the !located.ok branch, missing the unenriched check above
// it; the second found it was still possible to miss even that if
// chunk_plan.json is malformed JSON (a realistic hand-editing mistake),
// since JSON.parse throwing happens before either check runs; this round
// found that deleting chunk_plan.json to regenerate it from scratch (an
// explicitly documented, supported action — see PROMPT.md) and then
// re-running ingest:cut before finishing that regeneration hit the exact
// same gap, since the missing-chunk_plan.json guard used to exit before
// this invalidation ran at all. Placing this before every guard, read, and
// parse closes every exit path at once, rather than needing a matching
// invalidation added to each one individually as new ones are found. A
// stale chunks.json here is still marked "verified": true and no longer
// describes the current chunk_plan.json (or its absence); ingest:publish
// reads only that file and has no way to know it's stale. A successful run
// regenerates chunks.json fresh regardless, so this costs nothing on the
// success path either.
const chunksJsonPath = path.join(workDir, 'chunks.json');
if (existsSync(chunksJsonPath)) {
	rmSync(chunksJsonPath);
	console.log(
		`Cleared ${chunksJsonPath} from a previous cut — this run will regenerate it if it succeeds.`
	);
}

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

// A runtime-validated schema, not just a TypeScript type assertion — found
// in code review 2026-08-26: chunk_plan.json is explicitly hand-edited
// (that's step 4's whole job), and a plausible slip (a missing field, a
// null where a string was expected, the array replaced with something
// else) used to crash on the first .filter/.trim below with a raw
// TypeError instead of this file's usual actionable recovery guidance.
const RawChunkPlanEntrySchema = z.object({
	text: z.string(),
	kana: z.string(),
	translation: z.string()
});
const ChunkPlanSchema = z.array(RawChunkPlanEntrySchema);

const manifest: TranscriptManifest = JSON.parse(readFileSync(transcriptPath, 'utf8'));
const parsedChunkPlan = ChunkPlanSchema.safeParse(JSON.parse(readFileSync(chunkPlanPath, 'utf8')));
if (!parsedChunkPlan.success) {
	console.error(
		`${chunkPlanPath} isn't shaped as expected — it should be an array of entries with string "text", "kana", and "translation" fields. Check for a broken hand-edit and fix it, then re-run. Details: ${parsedChunkPlan.error.message}`
	);
	process.exit(1);
}
const rawPlan = parsedChunkPlan.data;

// Checked before enrichment, not after: a leftover merged-away entry
// ({ text: "", kana: "", translation: "" }) also has empty kana/
// translation, so without this ordering the unenriched check below would
// catch it first and tell the operator to fill it in — the wrong fix for
// an entry that should be deleted, not enriched. locateChunks has its own
// (later) empty-text check for defense in depth, but by then the operator
// has already been pointed at the wrong recovery. Found in code review
// 2026-08-26.
const emptyText = rawPlan.filter((p) => p.text.trim() === '');
if (emptyText.length > 0) {
	console.error(
		`${emptyText.length} entr${emptyText.length === 1 ? 'y has' : 'ies have'} empty "text" in chunk_plan.json — remove the leftover entr${emptyText.length === 1 ? 'y' : 'ies'} (likely left behind by a merge; don't fill it in) and re-run.`
	);
	process.exit(1);
}

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
// No chunks.json to invalidate here anymore by the time we reach this
// point — it was already cleared unconditionally near the top of this
// script (see chunksJsonPath there), specifically so every early-exit
// path (not just this success path) starts from "no stale manifest,"
// rather than needing a matching invalidation at each exit individually.
// The reasoning for clearing it BEFORE the rename loop below promotes any
// staged chunk audio still applies, it's just already satisfied: the
// promotion loop is interruptible (a kill signal, a crash between any two
// renames), and if a manifest were in place while some chunk-NN.m4a files
// have already been promoted to this run's audio and others haven't,
// ingest:publish would trust old (now-wrong) transcript/verified status
// for a manifest describing a mix of old and new chunk audio. No manifest
// existing at all from before this loop starts means an interruption at
// any point through it leaves no manifest at all — publish's own "no
// chunks.json" gate catches it regardless of exactly where an
// interruption lands, the same reasoning ingest:transcribe's source
// commit uses.

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
