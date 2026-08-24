import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, requireString, requireSafePathComponent } from '../args.ts';
import { splitIntoSentenceUnits } from '../chunk-planner.ts';

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

interface TranscriptManifest {
	transcript: string;
}

const manifest: TranscriptManifest = JSON.parse(readFileSync(transcriptPath, 'utf8'));

// Same guard as ingest:cut used to run before cutting — splitting an
// unpunctuated transcript produces one giant unit, which is a scaffold
// with nothing to actually group.
if (!/[。！？]/.test(manifest.transcript)) {
	console.error(
		'transcript.json has no sentence-final punctuation (。！？). Restore punctuation in the "transcript" field first (see PROMPT.md).'
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
