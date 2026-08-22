import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs, requireString } from '../args.ts';
import { toAnalysisWav, probeDurationMs } from '../audio-tools.ts';
import { transcribeWav } from '../transcribe.ts';
import { compareTranscripts } from '../transcript-diff.ts';
import { deriveListName } from '../../src/lib/list-naming.ts';
import { createAdminClient } from '../../scripts/lib/supabase-admin.ts';

const USAGE = `Usage: npm run ingest:transcribe -- --audio <file> --user <username> [--transcript <file>] [--accept-transcript]

Converts --audio to a 16k mono analysis wav, transcribes it with whisper,
and (if --transcript is given) cross-checks the supplied transcript against
whisper's own independent pass — aborting on real divergence unless
--accept-transcript is also passed. Writes ingest/work/<user>/<slug>/transcript.json.`;

const args = parseArgs(process.argv.slice(2));
const audioPath = requireString(args, 'audio', USAGE);
const username = requireString(args, 'user', USAGE);
const suppliedTranscriptPath = typeof args.transcript === 'string' ? args.transcript : undefined;
const acceptTranscript = args['accept-transcript'] === true;

if (!existsSync(audioPath)) {
	console.error(`No such audio file: ${audioPath}`);
	process.exit(1);
}

const supabase = createAdminClient();
const { data: user, error: userError } = await supabase
	.from('users')
	.select('id')
	.eq('username', username)
	.maybeSingle();
if (userError) {
	console.error('Failed to look up user:', userError.message);
	process.exit(1);
}
if (!user) {
	console.error(`No user named "${username}".`);
	process.exit(1);
}

const slug = deriveListName(path.basename(audioPath));
const workDir = path.join(import.meta.dirname, '..', 'work', username, slug);
mkdirSync(workDir, { recursive: true });

const sourceExt = path.extname(audioPath) || '.m4a';
const sourceOriginalPath = path.join(workDir, `source${sourceExt}`);
copyFileSync(audioPath, sourceOriginalPath);

const sourceWavPath = path.join(workDir, 'source.wav');
console.log(`Converting to analysis wav...`);
toAnalysisWav(sourceOriginalPath, sourceWavPath);
const durationMs = probeDurationMs(sourceWavPath);

console.log('Transcribing with whisper (this can take a minute or two)...');
const { text: asrText, segments } = transcribeWav(sourceWavPath);

let transcript: string;
let transcriptSource: 'supplied' | 'asr';

if (suppliedTranscriptPath) {
	if (!existsSync(suppliedTranscriptPath)) {
		console.error(`No such transcript file: ${suppliedTranscriptPath}`);
		process.exit(1);
	}
	const supplied = readFileSync(suppliedTranscriptPath, 'utf8').trim();
	const report = compareTranscripts(supplied, asrText);
	console.log(
		`\nTranscript cross-check: ${(report.overallSimilarity * 100).toFixed(1)}% similarity to whisper's independent pass.`
	);
	if (report.divergentSentences.length > 0) {
		console.log('Sentences with no good match in the ASR pass:');
		for (const s of report.divergentSentences) console.log(`  - ${s}`);
	}
	if (report.diverged && !acceptTranscript) {
		console.error(
			"\nSupplied transcript diverges enough from whisper's independent pass to abort — check the divergent sentences above (this is what catches a real ASR hallucination or a genuinely wrong supplied transcript). Re-run with --accept-transcript if you've confirmed the supplied text is correct."
		);
		process.exit(1);
	}
	transcript = supplied;
	transcriptSource = 'supplied';
} else {
	transcript = asrText;
	transcriptSource = 'asr';
}

interface TranscriptManifest {
	slug: string;
	user: string;
	sourceAudioPath: string;
	durationMs: number;
	transcript: string;
	transcriptSource: 'supplied' | 'asr';
	whisperSegments: { startMs: number; endMs: number; text: string }[];
}

const manifest: TranscriptManifest = {
	slug,
	user: username,
	sourceAudioPath: sourceOriginalPath,
	durationMs,
	transcript,
	transcriptSource,
	whisperSegments: segments
};

writeFileSync(path.join(workDir, 'transcript.json'), JSON.stringify(manifest, null, 2));

console.log(`\nWrote ${path.join(workDir, 'transcript.json')}`);
// Whether transcriptSource is 'asr' or 'supplied', what actually matters
// for the next step is whether the transcript text itself has
// sentence-final punctuation — a supplied file is only trimmed and
// similarity-checked above, never validated for this, so it can just as
// easily arrive unpunctuated as ASR output can. ingest:cut's own guard
// (see cut.ts) checks this regardless of source; this message just
// reports accurately which case applies instead of assuming "supplied"
// always means "already punctuated."
if (/[。！？]/.test(transcript)) {
	console.log(
		'\nNext: the transcript already has sentence-final punctuation — no editing needed. Run ingest:cut.'
	);
} else {
	console.log(
		'\nNext: restore sentence/clause punctuation (。、！？) in the "transcript" field — the chunk planner cuts on exactly those marks. See PROMPT.md.'
	);
}
