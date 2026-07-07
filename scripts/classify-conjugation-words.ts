import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

// This script only READS japanese-2000-most-frequent-words.md and WRITES
// src/lib/conjugation-word-list.ts — it never opens the frozen source list
// in write mode, so CLAUDE.md's "ask before touching
// japanese-2000-most-frequent-words.md" rule doesn't apply here.
//
// Run via `npm run classify-conjugation-words`. One-time/rarely-rerun tool —
// review the generated output file's diff before trusting it (see the
// summary this script prints, and 2.0.0's conjugation-drills design notes).

const ROOT = path.resolve(import.meta.dirname, '..');
const SOURCE_PATH = path.join(ROOT, 'japanese-2000-most-frequent-words.md');
const OUTPUT_PATH = path.join(ROOT, 'src', 'lib', 'conjugation-word-list.ts');

const MODEL = 'claude-haiku-4-5';
const PASS1_BATCH_SIZE = 40;
const AMBIGUOUS_BATCH_SIZE = 40;
const SURU_SAMPLE_SIZE = 25;

// Hand-curated rather than picked by pure frequency rank: the top 30
// na_adjective_or_noun words by frequency turned out to be 100% plain nouns
// (人, 私, 顔, 手, ...) — real な-adjectives like 同じ/必要/確か/好き/静か all
// rank just below that cutoff. Since な-adjectives are the more pedagogically
// interesting copula-drill target (they conjugate but don't read like a
// typical noun), this list is chosen directly for being common な-adjectives,
// not by frequency. Each entry is checked against the actual classified
// na_adjective_or_noun bucket at runtime (see below) rather than assumed
// present.
const CURATED_COPULA_WORDS = [
	'静か',
	'元気',
	'好き',
	'嫌い',
	'綺麗',
	'大切',
	'大事',
	'必要',
	'大丈夫',
	'簡単',
	'自由',
	'安全',
	'危険',
	'立派',
	'不思議',
	'真剣',
	'単純',
	'複雑',
	'奇妙',
	'完全',
	'明らか',
	'確か',
	'同じ',
	'特別',
	'正直',
	'大変',
	'だめ',
	'素直',
	'幸せ',
	'残念'
];

const VERB_CLASSES = [
	'godan_u',
	'godan_ku',
	'godan_gu',
	'godan_su',
	'godan_tsu',
	'godan_nu',
	'godan_bu',
	'godan_mu',
	'godan_ru',
	'ichidan',
	'suru',
	'kuru'
] as const;
type VerbClass = (typeof VERB_CLASSES)[number];

// A dictionary-form Japanese verb always ends in one of these 9 hiragana
// syllables (the godan "u-row" endings, or る for ichidan/suru/kuru). This
// is a hard grammatical fact, not a heuristic — so any word pass 1 tags
// "verb" that doesn't end in one of these is necessarily NOT a real
// conjugating dictionary-form verb (e.g. a bare kanji fragment like 会/言/来,
// or a suru-noun cited without する attached, like 用意/反応/報告). Those get
// excluded from the verb bucket entirely rather than trusted.
//
// 8 of these 9 endings mechanically determine the godan class with zero
// ambiguity (う->godan_u, く->godan_ku, ...). する/来る are also mechanically
// detectable by suffix. The ONLY genuine judgment call left is distinguishing
// ichidan from godan_ru for る-ending verbs that aren't suru/kuru compounds
// (the classic 食べる-vs-帰る trap) — an earlier version of this script
// wastefully (and unreliably — it got ある/なる/やる/分かる/入る/かかる/取る/
// こする wrong) asked an LLM to guess all 12 classes at once instead of just
// this one binary case.
const GODAN_ENDING_TO_CLASS: Record<string, VerbClass> = {
	う: 'godan_u',
	く: 'godan_ku',
	ぐ: 'godan_gu',
	す: 'godan_su',
	つ: 'godan_tsu',
	ぬ: 'godan_nu',
	ぶ: 'godan_bu',
	む: 'godan_mu'
};
const VALID_VERB_ENDINGS = new Set([...Object.keys(GODAN_ENDING_TO_CLASS), 'る']);

// Known problem entries in japanese-2000-most-frequent-words.md, found during
// 2.0.0 conjugation-drill classification review — excluded from conjugation
// drilling without editing the frozen source file (see CLAUDE.md), for two
// different reasons:
//   - まえる, ばる: don't parse as real standalone Japanese words (likely
//     truncated/garbled extraction artifacts from the source corpus — e.g.
//     まえる may be a fragment of 捕まえる, ばる of 頑張る/がんばる). Tracked
//     in https://github.com/dilyand/yutakanagoi/issues/25 to revisit the
//     source list itself.
//   - 隠る, 恐る: real words, but archaic/classical verb forms (modern
//     equivalents 隠れる/恐れる, both ichidan) probably from stylized/period
//     dialogue in the source corpus — a modern speaker conjugates the
//     ichidan form, not these, so drilling them with modern godan_ru
//     conjugation would teach forms nobody actually uses. Not a source-list
//     data error (no issue filed), just out of scope for this drill.
//   - ごとし: a classical auxiliary ("as if/like", 如し) with no modern
//     conjugation of its own — not a real content word for either the
//     i_adjective or na_adjective_or_noun bucket, unlike other words that
//     fail the i_adjective ending check (see the na_adjective_or_noun
//     reclassification below, which this is deliberately excluded from).
const KNOWN_BAD_SOURCE_ENTRIES = new Set(['まえる', 'ばる', '隠る', '恐る', 'ごとし']);

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
	console.error(
		'ANTHROPIC_API_KEY must be set — run via `npm run classify-conjugation-words` (loads .env).'
	);
	process.exit(1);
}
const client = new Anthropic({ apiKey, timeout: 20_000 });

interface SourceWord {
	word: string;
	frequencyRank: number;
}

function readSourceWords(): SourceWord[] {
	const text = readFileSync(SOURCE_PATH, 'utf-8');
	const words: SourceWord[] = [];
	let rank = 0;
	for (const line of text.split('\n')) {
		const match = line.match(/^- (.+)$/);
		if (!match) continue;
		rank += 1;
		words.push({ word: match[1].trim(), frequencyRank: rank });
	}
	return words;
}

function chunk<T>(items: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
	return chunks;
}

async function callWithRetry<T>(fn: () => Promise<T>, label: string, attempts = 2): Promise<T> {
	let lastError: unknown;
	for (let attempt = 1; attempt <= attempts; attempt++) {
		try {
			return await fn();
		} catch (e) {
			lastError = e;
			console.error(`${label} failed (attempt ${attempt}/${attempts}):`, e);
		}
	}
	throw lastError;
}

// ---- Pass 1: coarse POS classification (verb / i_adjective / na_adjective_or_noun / other) ----

const Pass1Pos = z.enum(['verb', 'i_adjective', 'na_adjective_or_noun', 'other']);
const Pass1Item = z.object({ word: z.string(), pos: Pass1Pos });
const Pass1Response = z.object({ items: z.array(Pass1Item) });

const PASS1_SYSTEM = `Classify each Japanese word (dictionary form) into exactly one of these
four part-of-speech buckets:

- "verb": a word that conjugates as a verb on its own (e.g. する, 食べる,
  話す, 行く, 来る). A real dictionary-form verb always ends in hiragana
  (u/ku/gu/su/tsu/nu/bu/mu/ru) — a bare kanji with no trailing hiragana
  (e.g. 会, 言, 来, 座, 帯, 立) is NOT itself a verb, even if it shares a
  reading with one. Likewise, a bare noun that a verb can be formed from by
  attaching する (e.g. 用意, 反応, 報告, 心配, 勉強) is a noun on its own,
  not a verb — only classify it "verb" if the word as given already
  includes する attached.
- "i_adjective": a plain-form adjective ending in い that conjugates on its
  own (e.g. 良い, 大きい, 美しい, いい).
- "na_adjective_or_noun": a な-adjective or noun — these don't conjugate
  themselves, only the copula (だ/です) attached to them does (e.g. きれい,
  静か, 元気, 学校, 本, 人, 用意, 心配). Numbers, common nouns, and
  na-adjectives written in kana or kanji all belong here.
- "other": anything else — particles, pronouns, demonstratives, adverbs,
  conjunctions, and grammatical/functional words that are not classifiable
  content words for conjugation drilling (e.g. こと, もの, その, それ, そう,
  これ, どこ, まだ, とても, もし, ちょっと).

Return one item per input word, echoing the exact word string back exactly
as given.`;

async function classifyPass1(words: SourceWord[]): Promise<Map<string, z.infer<typeof Pass1Pos>>> {
	const result = new Map<string, z.infer<typeof Pass1Pos>>();
	const batches = chunk(words, PASS1_BATCH_SIZE);
	for (const [i, batch] of batches.entries()) {
		console.log(`Pass 1: batch ${i + 1}/${batches.length} (${batch.length} words)`);
		const response = await callWithRetry(
			() =>
				client.messages.parse({
					model: MODEL,
					max_tokens: 4096,
					thinking: { type: 'disabled' },
					output_config: { format: zodOutputFormat(Pass1Response) },
					system: PASS1_SYSTEM,
					messages: [{ role: 'user', content: `Words:\n${batch.map((w) => w.word).join('\n')}` }]
				}),
			`Pass 1 batch ${i + 1}`
		);
		const parsed = Pass1Response.parse(response.parsed_output);
		for (const item of parsed.items) result.set(item.word, item.pos);
	}
	return result;
}

// ---- Deterministic verb-ending classification ----

type DeterministicResult =
	| { kind: 'invalid' } // pass 1 said "verb" but the ending proves it can't be one
	| { kind: 'certain'; verbClass: VerbClass }
	| { kind: 'ambiguous' }; // ends in る, not a suru/kuru compound — ichidan vs godan_ru

function classifyVerbDeterministic(word: string): DeterministicResult {
	const lastChar = word.at(-1) ?? '';
	if (!VALID_VERB_ENDINGS.has(lastChar)) return { kind: 'invalid' };
	if (lastChar !== 'る') return { kind: 'certain', verbClass: GODAN_ENDING_TO_CLASS[lastChar] };
	// Exact match only, not endsWith: unlike 来る (whose compounds like やって
	// 来る genuinely conjugate as kuru), a word merely ending in the two
	// characters す+る isn't necessarily a noun+する compound — こする
	// (kosuru, "to rub") is a lexicalized godan_ru verb with no "こす" noun,
	// and this corpus turns out to have zero genuine multi-character
	// noun+する compounds (they appear as bare nouns instead, e.g. 用意,
	// 反応 — see the pass-1 prompt's note on this). Anything else ending in
	// する falls through to the ambiguous ichidan/godan_ru pass below, which
	// has an explicit worked example for こする.
	if (word === 'する') return { kind: 'certain', verbClass: 'suru' };
	if (word === '来る' || word.endsWith('来る') || word.endsWith('くる')) {
		return { kind: 'certain', verbClass: 'kuru' };
	}
	return { kind: 'ambiguous' };
}

// ---- LLM pass: ichidan vs godan_ru only, for the genuinely ambiguous る-ending verbs ----

const AmbiguousClass = z.enum(['ichidan', 'godan_ru']);
const AmbiguousItem = z.object({
	word: z.string(),
	verbClass: AmbiguousClass,
	confidence: z.enum(['high', 'low'])
});
const AmbiguousResponse = z.object({ items: z.array(AmbiguousItem) });

const AMBIGUOUS_SYSTEM = `Every word below is a Japanese dictionary-form verb ending in る that is
NOT a する or 来る compound. Classify each as exactly one of:

- "ichidan" (ru-verb): conjugates by dropping る (e.g. 食べる -> 食べない,
  見る -> 見ない, 寝る -> 寝ない, 起きる -> 起きない, 出る -> 出ない).
- "godan_ru" (u-verb ending in る): conjugates by changing る to ら/り/れ/ろ
  (e.g. 帰る -> 帰らない, 走る -> 走らない, 入る -> 入らない, 知る -> 知らない,
  切る -> 切らない). This class also includes some very common verbs that
  are easy to mistake for a different pattern because they don't "feel"
  like a typical godan verb: ある -> ない (irregular negative, but ある is
  still godan_ru for every other form: あった/あって), なる -> ならない,
  やる -> やらない, 分かる -> 分からない, 入る -> 入らない, かかる ->
  かからない, 取る -> 取らない, こする -> こすらない.

Return one item per input word, echoing the exact word string back exactly
as given, plus a confidence of "low" if you are genuinely unsure for this
specific word (otherwise "high").`;

interface AmbiguousResult {
	verbClass: z.infer<typeof AmbiguousClass>;
	confidence: 'high' | 'low';
}

async function classifyAmbiguousVerbs(verbs: SourceWord[]): Promise<Map<string, AmbiguousResult>> {
	const result = new Map<string, AmbiguousResult>();
	const batches = chunk(verbs, AMBIGUOUS_BATCH_SIZE);
	for (const [i, batch] of batches.entries()) {
		console.log(`Ichidan/godan_ru pass: batch ${i + 1}/${batches.length} (${batch.length} verbs)`);
		const response = await callWithRetry(
			() =>
				client.messages.parse({
					model: MODEL,
					max_tokens: 4096,
					thinking: { type: 'disabled' },
					output_config: { format: zodOutputFormat(AmbiguousResponse) },
					system: AMBIGUOUS_SYSTEM,
					messages: [{ role: 'user', content: `Verbs:\n${batch.map((w) => w.word).join('\n')}` }]
				}),
			`Ichidan/godan_ru batch ${i + 1}`
		);
		const parsed = AmbiguousResponse.parse(response.parsed_output);
		for (const item of parsed.items) {
			result.set(item.word, { verbClass: item.verbClass, confidence: item.confidence });
		}
	}
	return result;
}

// ---- Assembling the output ----

interface ConjugationWordOut {
	word: string;
	frequencyRank: number;
	wordClass: string;
	included: boolean;
}

function pickTopByFrequency(words: SourceWord[], count: number): Set<string> {
	return new Set(
		words
			.slice()
			.sort((a, b) => a.frequencyRank - b.frequencyRank)
			.slice(0, count)
			.map((w) => w.word)
	);
}

// Single-quoted to match this project's Prettier config (singleQuote: true)
// so the generated file needs no separate `prettier --write` pass.
function quote(s: string): string {
	return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function renderOutputFile(words: ConjugationWordOut[]): string {
	const lines: string[] = [];
	lines.push('// Generated by scripts/classify-conjugation-words.ts — do not hand-edit the');
	lines.push('// CONJUGATION_WORDS array directly except to fix a misclassification found');
	lines.push('// during review; re-running the script will overwrite manual edits.');
	lines.push('');
	lines.push('export type VerbClass =');
	lines.push(`\t| ${VERB_CLASSES.map((c) => `'${c}'`).join('\n\t| ')};`);
	lines.push('');
	lines.push("export type WordClass = VerbClass | 'i_adjective' | 'copula';");
	lines.push('');
	lines.push('export interface ConjugationWord {');
	lines.push('\tword: string;');
	lines.push('\t/** Position in japanese-2000-most-frequent-words.md (1-based). */');
	lines.push('\tfrequencyRank: number;');
	lines.push('\twordClass: WordClass;');
	lines.push('\t/**');
	lines.push('\t * False only for non-sampled suru/copula words; always true for verb');
	lines.push('\t * classes and i_adjective, which are never down-sampled.');
	lines.push('\t */');
	lines.push('\tincluded: boolean;');
	lines.push('}');
	lines.push('');
	lines.push('export const CONJUGATION_WORDS: ConjugationWord[] = [');
	for (const w of words) {
		lines.push(
			`\t{ word: ${quote(w.word)}, frequencyRank: ${w.frequencyRank}, wordClass: ${quote(w.wordClass)}, included: ${w.included} },`
		);
	}
	lines.push('];');
	lines.push('');
	return lines.join('\n');
}

async function main() {
	const words = readSourceWords();
	console.log(`Read ${words.length} words from ${path.basename(SOURCE_PATH)}.`);

	const pass1 = await classifyPass1(words);
	const missingPass1 = words.filter((w) => !pass1.has(w.word));
	if (missingPass1.length > 0) {
		console.error(
			`Warning: ${missingPass1.length} words missing from pass 1 output, treated as "other":`,
			missingPass1.map((w) => w.word)
		);
	}

	for (const bad of KNOWN_BAD_SOURCE_ENTRIES) pass1.delete(bad);

	const verbCandidates = words.filter((w) => pass1.get(w.word) === 'verb');
	const iAdjectiveCandidates = words.filter((w) => pass1.get(w.word) === 'i_adjective');

	// Same bare-kanji-fragment guard as the verb-ending check above: a real
	// dictionary-form i-adjective always ends in hiragana い. Anything tagged
	// "i_adjective" that doesn't end in い is virtually always actually a
	// na-adjective/noun that pass 1 confused for one (e.g. 白/薄 are the noun/
	// prefix forms of 白い/薄い, 真っ赤 is a na-adjective — 真っ赤な/だ, not
	// 真っ赤い, 同じ famously conjugates like a na-adjective despite meaning
	// "same") — so these get reclassified into the copula candidate pool
	// rather than dropped, except for KNOWN_BAD_SOURCE_ENTRIES-style cases
	// that aren't a real content word in either category (see ごとし there:
	// a classical auxiliary, not a modern adjective or noun).
	const iAdjectives = iAdjectiveCandidates.filter((w) => w.word.endsWith('い'));
	const misclassifiedAsIAdjective = iAdjectiveCandidates.filter((w) => !w.word.endsWith('い'));
	if (misclassifiedAsIAdjective.length > 0) {
		console.log(
			`\nReclassified ${misclassifiedAsIAdjective.length} pass-1 "i_adjective" tags that don't end ` +
				'in い as na_adjective_or_noun instead:'
		);
		for (const w of misclassifiedAsIAdjective) console.log(`  ${w.word}`);
	}

	const copulaCandidates = [
		...words.filter((w) => pass1.get(w.word) === 'na_adjective_or_noun'),
		...misclassifiedAsIAdjective
	];

	const invalidVerbs: SourceWord[] = [];
	const certainVerbs = new Map<string, VerbClass>();
	const ambiguousVerbs: SourceWord[] = [];
	for (const w of verbCandidates) {
		const det = classifyVerbDeterministic(w.word);
		if (det.kind === 'invalid') invalidVerbs.push(w);
		else if (det.kind === 'certain') certainVerbs.set(w.word, det.verbClass);
		else ambiguousVerbs.push(w);
	}
	if (invalidVerbs.length > 0) {
		console.log(
			`\nExcluded ${invalidVerbs.length} pass-1 "verb" tags that fail the dictionary-form-ending check ` +
				'(bare kanji fragments or suru-nouns cited without する attached), not trusted as verbs:'
		);
		for (const w of invalidVerbs) console.log(`  ${w.word}`);
	}

	const ambiguousResults = await classifyAmbiguousVerbs(ambiguousVerbs);
	const missingAmbiguous = ambiguousVerbs.filter((w) => !ambiguousResults.has(w.word));
	if (missingAmbiguous.length > 0) {
		console.error(
			`Warning: ${missingAmbiguous.length} verbs missing from the ichidan/godan_ru pass, dropped entirely:`,
			missingAmbiguous.map((w) => w.word)
		);
	}

	const suruWords = verbCandidates.filter((w) => certainVerbs.get(w.word) === 'suru');
	const suruSample = pickTopByFrequency(suruWords, SURU_SAMPLE_SIZE);

	const copulaCandidateWords = new Set(copulaCandidates.map((w) => w.word));
	const missingCuratedCopula = CURATED_COPULA_WORDS.filter((w) => !copulaCandidateWords.has(w));
	if (missingCuratedCopula.length > 0) {
		console.error(
			`Warning: ${missingCuratedCopula.length} curated copula words not found in this run's ` +
				'na_adjective_or_noun classification, skipped:',
			missingCuratedCopula
		);
	}
	const copulaSample = new Set(CURATED_COPULA_WORDS.filter((w) => copulaCandidateWords.has(w)));

	const output: ConjugationWordOut[] = [];

	for (const w of verbCandidates) {
		const verbClass = certainVerbs.get(w.word) ?? ambiguousResults.get(w.word)?.verbClass;
		if (!verbClass) continue;
		const included = verbClass === 'suru' ? suruSample.has(w.word) : true;
		output.push({ word: w.word, frequencyRank: w.frequencyRank, wordClass: verbClass, included });
	}

	for (const w of iAdjectives) {
		output.push({
			word: w.word,
			frequencyRank: w.frequencyRank,
			wordClass: 'i_adjective',
			included: true
		});
	}

	for (const w of copulaCandidates) {
		output.push({
			word: w.word,
			frequencyRank: w.frequencyRank,
			wordClass: 'copula',
			included: copulaSample.has(w.word)
		});
	}

	output.sort((a, b) => a.frequencyRank - b.frequencyRank);

	// Deterministic sanity check: every non-i_adjective/copula entry's word
	// must end in the kana its class implies. This should never fail given
	// the classification logic above — if it does, that's a bug in this
	// script, not a model quality issue, and needs fixing before trusting
	// the output.
	const endingForClass: Record<VerbClass, string | null> = {
		godan_u: 'う',
		godan_ku: 'く',
		godan_gu: 'ぐ',
		godan_su: 'す',
		godan_tsu: 'つ',
		godan_nu: 'ぬ',
		godan_bu: 'ぶ',
		godan_mu: 'む',
		godan_ru: 'る',
		ichidan: 'る',
		suru: null,
		kuru: null
	};
	const inconsistencies = output.filter((w) => {
		const expected = endingForClass[w.wordClass as VerbClass];
		return expected !== undefined && expected !== null && !w.word.endsWith(expected);
	});
	if (inconsistencies.length > 0) {
		console.error('\nBUG: found ending-inconsistent entries after deterministic classification:');
		for (const w of inconsistencies) console.error(`  ${w.word} -> ${w.wordClass}`);
		throw new Error('Ending-consistency check failed — fix the script before trusting output.');
	}

	// ---- Summary ----
	const counts = new Map<string, number>();
	for (const w of output) counts.set(w.wordClass, (counts.get(w.wordClass) ?? 0) + 1);
	const includedCounts = new Map<string, number>();
	for (const w of output) {
		if (w.included) includedCounts.set(w.wordClass, (includedCounts.get(w.wordClass) ?? 0) + 1);
	}
	console.log('\nClassification summary (total / included):');
	for (const [cls, count] of [...counts.entries()].sort()) {
		console.log(`  ${cls}: ${count} / ${includedCounts.get(cls) ?? 0}`);
	}
	const otherCount =
		words.length - verbCandidates.length - iAdjectives.length - copulaCandidates.length;
	console.log(`  other (excluded from conjugation drilling): ${otherCount}`);
	console.log(`  invalid verb tags excluded: ${invalidVerbs.length}`);
	console.log(`  i_adjective tags reclassified as copula: ${misclassifiedAsIAdjective.length}`);

	const lowConfidence = [...ambiguousResults.entries()].filter(([, v]) => v.confidence === 'low');
	if (lowConfidence.length > 0) {
		console.log(`\nLow-confidence ichidan/godan_ru classifications (review these first):`);
		for (const [word, v] of lowConfidence) console.log(`  ${word}: ${v.verbClass}`);
	} else {
		console.log('\nNo low-confidence ichidan/godan_ru classifications.');
	}

	console.log(
		`\nsuru bucket (${suruWords.length} total): ${suruWords.map((w) => w.word).join(', ') || '(none)'}`
	);

	// ---- Write output file ----
	const fileContents = renderOutputFile(output);
	writeFileSync(OUTPUT_PATH, fileContents, 'utf-8');
	console.log(`\nWrote ${output.length} entries to ${path.relative(ROOT, OUTPUT_PATH)}.`);
	console.log('Review the diff before using this file for the forms registry (step 2).');
}

await main();
