import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
	copyFileSync
} from 'node:fs';
import path from 'node:path';
import { parseArgs, requireString, requireSafePathComponent } from '../args.ts';
import { toAnalysisWav, probeDurationMs } from '../audio-tools.ts';
import { transcribeWav } from '../transcribe.ts';
import { compareTranscripts } from '../transcript-diff.ts';
import { deriveListName } from '../../src/lib/list-naming.ts';
import { createAdminClient } from '../../scripts/lib/supabase-admin.ts';

const USAGE = `Usage: npm run ingest:transcribe -- --audio <file> --user <username> [--transcript <file>] [--accept-transcript]

Converts --audio to a 16k mono analysis wav, transcribes it with whisper,
and (if --transcript is given) cross-checks the supplied transcript against
whisper's own independent pass — aborting on real divergence unless
--accept-transcript is also passed. Writes ingest/work/<user>/<slug>/transcript.json
with "kana"/"translation" left blank for the next step.`;

const args = parseArgs(process.argv.slice(2));
const audioPath = requireString(args, 'audio', USAGE);
const username = requireSafePathComponent(requireString(args, 'user', USAGE), 'username');
if (args.transcript === true) {
	// parseArgs treats a --transcript with no following value (missing
	// entirely, or immediately followed by another --flag) as the boolean
	// true, same as any other bare flag. Silently coercing that to
	// "not supplied" (the old behavior) meant a simple usage mistake —
	// forgetting the file path — quietly fell back to the ASR-only path
	// instead of erroring, skipping the independent cross-check the
	// operator explicitly asked for.
	console.error(`--transcript requires a file path.\n\n${USAGE}`);
	process.exit(1);
}
const suppliedTranscriptPath = typeof args.transcript === 'string' ? args.transcript : undefined;
const acceptTranscript = args['accept-transcript'] === true;

if (!existsSync(audioPath)) {
	console.error(`No such audio file: ${audioPath}`);
	process.exit(1);
}
if (suppliedTranscriptPath && !existsSync(suppliedTranscriptPath)) {
	// Checked up front, not after the divergence gate runs — the whole
	// point of validating a cheap precondition first is to fail before
	// paying for the expensive part. This used to only be checked deep
	// inside the transcriptSource branch below, meaning a --transcript
	// typo still paid for the full audio conversion and whisper pass
	// (documented above as taking minutes) before erroring on something a
	// stat() call could have caught immediately.
	console.error(`No such transcript file: ${suppliedTranscriptPath}`);
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

// deriveListName's extension-stripping and separator-collapsing never
// touches literal dots, so a filename like "...m4a" derives to "..", and
// one like "-.m4a" derives to "" — both unsafe as a path.join component
// below (".." navigates out of the user's own work directory entirely; ""
// collapses workDir to the user's own root, silently landing every file
// there instead of a proper <user>/<slug>/ subdirectory).
const slug = requireSafePathComponent(
	deriveListName(path.basename(audioPath)),
	`slug derived from "${path.basename(audioPath)}"`
);
const workDir = path.join(import.meta.dirname, '..', 'work', username, slug);
mkdirSync(workDir, { recursive: true });

const sourceExt = path.extname(audioPath) || '.m4a';
const sourceOriginalPath = path.join(workDir, `source${sourceExt}`);
const sourceWavPath = path.join(workDir, 'source.wav');

// Staged under temp names, not the final source.<ext>/source.wav, until
// every fallible step below (conversion, whisper, the divergence gate)
// has succeeded. Without this staging, a same-extension re-transcribe
// that later aborts (a bad audio file, a whisper crash, a genuine
// divergence) would already have overwritten the retained source, even
// though the retained transcript.json — including any kana/translation
// already hand-filled against it — is kept around specifically to still
// be valid.
const tempSourcePath = path.join(workDir, `.tmp-source${sourceExt}`);
const tempWavPath = path.join(workDir, '.tmp-source.wav');
copyFileSync(audioPath, tempSourcePath);

console.log(`Converting to analysis wav...`);
toAnalysisWav(tempSourcePath, tempWavPath);
const durationMs = probeDurationMs(tempWavPath);

console.log('Transcribing with whisper (this can take a minute or two)...');
const { text: asrText, segments } = transcribeWav(tempWavPath);

let transcript: string;
let transcriptSource: 'supplied' | 'asr';

if (suppliedTranscriptPath) {
	const supplied = readFileSync(suppliedTranscriptPath, 'utf8').trim();
	const report = compareTranscripts(
		supplied,
		asrText,
		segments.map((s) => s.text)
	);
	console.log(
		`\nTranscript cross-check: ${(report.overallSimilarity * 100).toFixed(1)}% similarity to whisper's independent pass.`
	);
	if (report.divergentSentences.length > 0) {
		console.log('Sentences with no good match in the ASR pass:');
		for (const s of report.divergentSentences) console.log(`  - ${s}`);
	}
	if (report.asrOnlySpans.length > 0) {
		console.log('ASR segments with no good match in the supplied transcript:');
		for (const s of report.asrOnlySpans) console.log(`  - ${s}`);
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

// Everything fallible (conversion, whisper, the divergence gate) has now
// succeeded — safe to commit. The existing transcript.json (if any) is
// invalidated FIRST, before either source rename below, not after — a
// re-transcribe overwriting it wholesale is what resets kana/translation
// to blank for the new manifest, but only once it's actually rewritten a
// few lines down. An interruption (crash, kill signal) after the source
// rename but before that rewrite would otherwise leave the OLD, still
// fully-enriched (and so still publishable) transcript.json on disk,
// paired with the just-replaced NEW audio it was never actually
// transcribed or enriched against — ingest:publish trusts transcript.json
// outright and would publish that mismatch silently. Deleting it first
// means an interruption at any point from here through the write below
// leaves no manifest at all — publish's own "no transcript.json" gate
// (see cli/publish.ts) catches it regardless of exactly where an
// interruption lands.
const transcriptJsonPath = path.join(workDir, 'transcript.json');
if (existsSync(transcriptJsonPath)) rmSync(transcriptJsonPath);

renameSync(tempSourcePath, sourceOriginalPath);
renameSync(tempWavPath, sourceWavPath);

interface TranscriptManifest {
	slug: string;
	user: string;
	sourceAudioPath: string;
	durationMs: number;
	transcript: string;
	transcriptSource: 'supplied' | 'asr';
	whisperSegments: { startMs: number; endMs: number; text: string }[];
	kana: string;
	translation: string;
}

const manifest: TranscriptManifest = {
	slug,
	user: username,
	sourceAudioPath: sourceOriginalPath,
	durationMs,
	transcript,
	transcriptSource,
	whisperSegments: segments,
	kana: '',
	translation: ''
};

writeFileSync(transcriptJsonPath, JSON.stringify(manifest, null, 2));

console.log(`\nWrote ${transcriptJsonPath}`);
console.log(
	'\nNext: proofread/punctuate the "transcript" field for readability (optional — nothing splits on punctuation anymore), then fill "kana" and "translation" for the whole recording, then run ingest:publish. See PROMPT.md.'
);
