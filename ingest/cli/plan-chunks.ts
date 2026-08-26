import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { parseArgs, requireString, requireSafePathComponent } from '../args.ts';
import { splitIntoSentenceUnits, normalizeMarkWidth } from '../chunk-planner.ts';

const USAGE = `Usage: npm run ingest:plan-chunks -- --slug <slug> --user <username>

Reads ingest/work/<user>/<slug>/transcript.json and splits its transcript
into atomic sentence-final-mark-bounded units, writing
ingest/work/<user>/<slug>/chunk_plan.json — one entry per unit, kana/
translation left blank. This is a scaffold, not a finished plan: group
adjacent entries that belong together by meaning (merge by concatenating
their "text", delete the entries you merged away) and fill kana/
translation for each final chunk before running ingest:cut. Refuses to
overwrite an existing chunk_plan.json — remove it by hand first if you
actually want to regenerate the scaffold from scratch.`;

const args = parseArgs(process.argv.slice(2));
const slug = requireSafePathComponent(requireString(args, 'slug', USAGE), 'slug');
const username = requireSafePathComponent(requireString(args, 'user', USAGE), 'username');

const workDir = path.join(import.meta.dirname, '..', 'work', username, slug);
const transcriptPath = path.join(workDir, 'transcript.json');
if (!existsSync(transcriptPath)) {
	console.error(`No transcript.json at ${transcriptPath} — run ingest:transcribe first.`);
	process.exit(1);
}

const chunkPlanPath = path.join(workDir, 'chunk_plan.json');
if (existsSync(chunkPlanPath)) {
	console.error(
		`${chunkPlanPath} already exists — refusing to overwrite it (it may already have grouping/kana/translation work in it). Remove it by hand first if you want to regenerate the scaffold from scratch.`
	);
	process.exit(1);
}

// A runtime-validated schema, not just a TypeScript type assertion, for
// the same reason as cut.ts's chunk_plan.json schema: transcript.json's
// "transcript" field is hand-edited in the preceding workflow step (step
// 2: restoring punctuation, fixing ASR typos/mangled names) — a broken
// edit could leave it missing or the wrong type even in otherwise-valid
// JSON, which would otherwise crash on the first normalizeMarkWidth call
// below with a raw TypeError. Found in code review 2026-08-26.
const TranscriptManifestSchema = z.object({ transcript: z.string() });

let parsedJson: unknown;
try {
	parsedJson = JSON.parse(readFileSync(transcriptPath, 'utf8'));
} catch (e) {
	console.error(
		`${transcriptPath} isn't valid JSON — check for a broken hand-edit (an unescaped quote, a stray trailing comma, unbalanced braces) and fix it, then re-run. Details: ${(e as Error).message}`
	);
	process.exit(1);
}
const parsedManifest = TranscriptManifestSchema.safeParse(parsedJson);
if (!parsedManifest.success) {
	console.error(
		`${transcriptPath} isn't shaped as expected — it should have a string "transcript" field. Check for a broken hand-edit and fix it, then re-run. Details: ${parsedManifest.error.message}`
	);
	process.exit(1);
}
const manifest = parsedManifest.data;

// Checked against the width-normalized text, not the raw field — a
// transcript whose sentence-final marks are all half-width (ASCII) ?/!
// would otherwise be rejected here even though splitIntoSentenceUnits
// below normalizes width itself and would handle it fine (found in code
// review 2026-08-24: this guard predates that normalization and was never
// updated to match). Splitting a transcript with no sentence-final mark
// at all (of either width) produces one giant unit, a scaffold with
// nothing to actually group — that's what this guard actually protects
// against.
if (!/[。！？]/.test(normalizeMarkWidth(manifest.transcript))) {
	console.error(
		'transcript.json has no sentence-final punctuation (。！？, or half-width ?/!). Restore punctuation in the "transcript" field first (see PROMPT.md).'
	);
	process.exit(1);
}

const units = splitIntoSentenceUnits(manifest.transcript);

interface ChunkPlanEntry {
	text: string;
	kana: string;
	translation: string;
}

const plan: ChunkPlanEntry[] = units.map((text) => ({ text, kana: '', translation: '' }));
writeFileSync(chunkPlanPath, JSON.stringify(plan, null, 2));

console.log(`Wrote ${chunkPlanPath} — ${plan.length} atomic unit(s).`);
console.log(
	'\nNext: group adjacent entries that belong together by meaning (merge by concatenating "text", delete the merged-away entries), fill "kana"/"translation" for each final chunk, then run ingest:cut. See PROMPT.md.'
);
