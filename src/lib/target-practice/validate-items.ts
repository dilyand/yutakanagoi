import { parseTag, isRequiredTag, tagProblem } from './distractor-tags';
import {
	TARGET_MASK,
	countBlanks,
	fillBlank,
	hasJapaneseScript,
	hasLatinLetter,
	normalizeAnswer,
	toHiragana
} from './normalize';
import { PHASE_KINDS, skeletonFor } from './skeleton';
import type { PhaseSpec } from './skeleton';
import { PHASE_IDS } from './types';
import type { Card, ClaudeItem, Item, McItem, PhaseId, TilesItem, TypedItem } from './types';

/**
 * Deterministic validation of generated items (design doc §5). Takes
 * `unknown` because it checks model output, and never throws: a bad item is
 * dropped with a reason (logged so prompts can be tuned), not an exception.
 *
 * What it cannot catch: whether the Japanese is natural or a key is actually
 * right. That residual risk belongs to the flag button and, for Contrast, the
 * verification pass.
 */

export interface ValidateOptions {
	/**
	 * Generation stage being validated. Stage 1 and 2 are generated in
	 * parallel and validated separately; each only checks the phases it owns.
	 * Omit to validate a whole session at once.
	 */
	stage?: 1 | 2;
	/** Already-validated items from the other stage, for cross-stage dedupe and coverage. */
	priorItems?: Item[];
	/**
	 * Sentences from an earlier round ("Another round"): items repeating one are
	 * dropped like any other duplicate sentence. Compared after normalization.
	 */
	avoidSentences?: string[];
}

export interface DroppedItem {
	id: string;
	reason: string;
}

export type SetIssueCode =
	| 'phase_below_minimum'
	| 'coverage_missing'
	| 'coverage_dominant'
	| 'sort_unbalanced'
	| 'no_non_target_situation';

/** A problem with the set as a whole — the fix is regenerating a phase, not dropping an item. */
export interface SetIssue {
	code: SetIssueCode;
	phase?: PhaseId;
	detail: string;
}

export interface ValidationResult {
	/** Items that passed, in the order given. */
	valid: Item[];
	dropped: DroppedItem[];
	setIssues: SetIssue[];
}

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}
function nonEmpty(v: unknown): v is string {
	return typeof v === 'string' && v.trim() !== '';
}
function isStringArray(v: unknown): v is string[] {
	return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

// --- Public entry point ----------------------------------------------------

export function validateItems(
	card: Card,
	rawItems: unknown[],
	options: ValidateOptions = {}
): ValidationResult {
	const spec = skeletonFor(card);
	const prior = options.priorItems ?? [];
	const dropped: DroppedItem[] = [];

	// 1. Per-item checks.
	const survivors: Item[] = [];
	rawItems.forEach((raw, index) => {
		const shaped = shapeCheck(raw);
		if (typeof shaped === 'string') {
			dropped.push({ id: isRec(raw) && nonEmpty(raw.id) ? raw.id : `#${index}`, reason: shaped });
			return;
		}
		const problem = itemProblem(card, shaped, spec, options.stage);
		if (problem) dropped.push({ id: shaped.id, reason: problem });
		else survivors.push(shaped);
	});

	// 2. Dedupe — ids first, then sentences. Earlier items win; stage 2 sees stage 1.
	const seenIds = new Set(prior.map((i) => i.id));
	const seenContent = new Set<string>([
		...cardModelSentences(card).map(normalizeAnswer),
		...(options.avoidSentences ?? [])
			.map(normalizeAnswer)
			.filter((k) => k.length >= MIN_DEDUPE_LENGTH),
		...prior.flatMap(contentKeys)
	]);
	const valid: Item[] = [];
	for (const item of survivors) {
		if (seenIds.has(item.id)) {
			dropped.push({ id: item.id, reason: 'duplicate_id: id already used' });
			continue;
		}
		const keys = contentKeys(item);
		const clash = keys.find((k) => seenContent.has(k));
		if (clash !== undefined) {
			dropped.push({
				id: item.id,
				reason:
					'duplicate_sentence: same sentence as an earlier item, an earlier round or a card model sentence'
			});
			continue;
		}
		seenIds.add(item.id);
		keys.forEach((k) => seenContent.add(k));
		valid.push(item);
	}

	return { valid, dropped, setIssues: setIssues(card, spec, valid, prior, options.stage) };
}

// --- Shape -----------------------------------------------------------------

function shapeCheck(raw: unknown): Item | string {
	if (!isRec(raw)) return 'shape: item is not an object';
	if (!nonEmpty(raw.id)) return 'shape: id is missing';
	if (!PHASE_IDS.includes(raw.phase as PhaseId)) return `shape: unknown phase ${String(raw.phase)}`;
	if (!nonEmpty(raw.rationale)) return 'shape: rationale is missing';
	if (!nonEmpty(raw.targetSpan)) return 'shape: targetSpan is missing';
	for (const key of ['instruction', 'sentence', 'kana', 'focus', 'coverage'] as const) {
		if (raw[key] !== undefined && typeof raw[key] !== 'string')
			return `shape: ${key} must be a string`;
	}
	if (raw.spare !== undefined && typeof raw.spare !== 'boolean')
		return 'shape: spare must be a boolean';

	switch (raw.kind) {
		case 'mc':
			if (
				!Array.isArray(raw.options) ||
				!raw.options.every(
					(o) =>
						isRec(o) &&
						nonEmpty(o.text) &&
						typeof o.correct === 'boolean' &&
						(o.tag === undefined || nonEmpty(o.tag))
				)
			) {
				return 'shape: options must be {text, correct, tag?} objects';
			}
			break;
		case 'typed':
			if (raw.form !== 'cloze' && raw.form !== 'free')
				return 'shape: typed form must be cloze or free';
			if (!nonEmpty(raw.answer)) return 'shape: typed answer is missing';
			if (!isStringArray(raw.accepted) || raw.accepted.length === 0)
				return 'shape: accepted must be a non-empty string array';
			if (!nonEmpty(raw.hint)) return 'shape: hint is missing';
			if (raw.cue !== undefined && typeof raw.cue !== 'string')
				return 'shape: cue must be a string';
			break;
		case 'tiles':
			if (!isStringArray(raw.tiles) || raw.tiles.some((t) => t.trim() === ''))
				return 'shape: tiles must be non-empty strings';
			if (!isStringArray(raw.accepted) || raw.accepted.length === 0)
				return 'shape: accepted must be a non-empty string array';
			break;
		case 'claude':
			if (!isStringArray(raw.expected)) return 'shape: expected must be a string array';
			if (raw.free !== undefined && typeof raw.free !== 'boolean')
				return 'shape: free must be a boolean';
			break;
		default:
			return `shape: unknown kind ${String(raw.kind)}`;
	}
	return raw as unknown as Item;
}

// --- Per-item rules --------------------------------------------------------

/**
 * The English `instruction` may not carry Japanese the learner has to read (it
 * has no kana line, and naming the target would give it away) — but natural
 * English grammar talk includes short labels: な-adjective, て-form, ない-form, だ.
 * The first real model run (smoke test, 2026-10-17) dropped items for exactly
 * that, so the rule is "no run of more than two Japanese characters", which
 * lets those labels through and still stops a quoted word or sentence.
 */
export const MAX_INSTRUCTION_JAPANESE_RUN = 2;

function longestJapaneseRun(text: string): number {
	return Math.max(
		0,
		...(text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー]+/gu) ?? []).map(
			(m) => m.length
		)
	);
}

function itemProblem(card: Card, item: Item, spec: PhaseSpec[], stage?: 1 | 2): string | null {
	const phaseSpec = spec.find((p) => p.id === item.phase);
	if (!phaseSpec) return `unknown_phase: ${item.phase} is not in the ${card.type} skeleton`;
	if (stage !== undefined && phaseSpec.stage !== stage) {
		return `phase_out_of_stage: ${item.phase} belongs to stage ${phaseSpec.stage}, not ${stage}`;
	}
	if (!PHASE_KINDS[item.phase].includes(item.kind)) {
		return `kind_not_allowed: ${item.kind} items are not used in ${item.phase}`;
	}

	if (item.kind !== 'tiles' && !item.instruction?.trim() && !item.sentence?.trim()) {
		return 'no_prompt: needs an instruction or a sentence';
	}
	if (item.instruction && longestJapaneseRun(item.instruction) > MAX_INSTRUCTION_JAPANESE_RUN) {
		return 'language: instruction contains Japanese words (put Japanese in `sentence`)';
	}
	if (!hasLatinLetter(item.rationale)) return 'language: rationale must be written in English';
	if (item.kind === 'typed' && !hasLatinLetter(item.hint))
		return 'language: hint must be written in English';

	if (item.sentence !== undefined) {
		const p = sentenceProblem(item);
		if (p) return p;
	}
	if (item.focus !== undefined && !(item.sentence ?? '').includes(item.focus)) {
		return 'focus: not a substring of the sentence';
	}

	const kindProblem =
		item.kind === 'mc'
			? mcProblem(card, item)
			: item.kind === 'typed'
				? typedProblem(item)
				: item.kind === 'tiles'
					? tilesProblem(item)
					: claudeProblem(item);
	if (kindProblem) return kindProblem;

	return coverageProblem(card, item) ?? targetPresenceProblem(card, item);
}

function sentenceProblem(item: Item): string | null {
	const sentence = item.sentence ?? '';
	if (!hasJapaneseScript(sentence)) return 'language: sentence contains no Japanese';
	if (!item.kana || item.kana.trim() === '') return 'kana: sentence has no kana line';

	const stripped = item.kana
		.split(TARGET_MASK)
		.join('')
		.replace(/(^|\s)[A-Z]\s*[:：]/g, '$1');
	// \s: a dialogue is often written one speaker per line.
	if (/[^ぁ-ゟァ-ヿ\p{P}\p{Z}\p{S}\p{Nd}＿\s]/u.test(stripped)) {
		return 'kana: kana line contains something other than kana and punctuation';
	}
	const occurs = sentence.includes(item.targetSpan);
	const masked = item.kana.includes(TARGET_MASK);
	if (occurs && !masked)
		return `kana: target appears in the sentence but ${TARGET_MASK} is missing from the kana line`;
	if (!occurs && masked)
		return `kana: ${TARGET_MASK} is in the kana line but the target is not in the sentence`;
	return null;
}

function mcProblem(card: Card, item: McItem): string | null {
	const { options } = item;
	if (options.length < 2 || options.length > 4)
		return `mc_option_count: ${options.length} options, need 2-4`;
	const normalized = options.map((o) => normalizeAnswer(o.text));
	if (normalized.some((n) => n === ''))
		return 'mc_empty_option: an option is empty after normalization';
	if (new Set(normalized).size !== options.length)
		return 'mc_duplicate_options: two options are the same';
	const correct = options.filter((o) => o.correct).length;
	if (correct !== 1) return `mc_correct_count: ${correct} correct options, need exactly 1`;

	const senseIds = card.type === 'word' ? card.senses.map((s) => s.id) : [];
	const ownSense = item.coverage?.startsWith('sense:') ? item.coverage.slice(6) : undefined;
	let hasRequired = false;
	for (const o of options) {
		if (o.correct) {
			if (o.tag !== undefined) return 'tag_on_correct: the correct option must not carry a tag';
			continue;
		}
		if (o.tag === undefined) {
			if (item.phase === 'understand')
				return 'untagged_distractor: every wrong option in Understand needs a tag';
			continue;
		}
		const problem = tagProblem(card.type, o.tag);
		if (problem) return `bad_tag: ${problem}`;
		const { name, param } = parseTag(o.tag);
		if (name === 'other_sense') {
			if (!senseIds.map(String).includes(param ?? ''))
				return `bad_tag: other_sense:${param} is not a sense on the card`;
			if (param === ownSense) return `bad_tag: other_sense:${param} is the item's own sense`;
		}
		if (isRequiredTag(card.type, o.tag)) hasRequired = true;
	}
	// A one-sense Word has no "other sense" to misapply, so the required tag
	// cannot exist there; its distractors are context/opposite/unrelated.
	const requiredTagPossible = !(card.type === 'word' && card.senses.length === 1);
	if (item.phase === 'understand' && requiredTagPossible && !hasRequired) {
		return `missing_required_tag: needs a valid-meaning-wrong-place distractor (${card.type})`;
	}
	return null;
}

function cleanFillProblem(filled: string): string | null {
	if (/＿/.test(filled)) return 'a blank is left over';
	if (/([。、！？])\1/.test(filled)) return 'doubled punctuation';
	for (const [open, close] of [
		['（', '）'],
		['「', '」']
	]) {
		if (filled.split(open).length !== filled.split(close).length)
			return `unbalanced ${open}${close}`;
	}
	if (/\s{2,}/.test(filled)) return 'repeated whitespace';
	return null;
}

function typedProblem(item: TypedItem): string | null {
	const accepted = item.accepted.map(normalizeAnswer);
	if (accepted.some((a) => a === '')) return 'typed_empty_accepted: an accepted answer is empty';
	if (!accepted.includes(normalizeAnswer(item.answer))) {
		return 'typed_answer_not_accepted: the canonical answer is not in accepted';
	}
	if (!hasJapaneseScript(item.answer)) return 'language: typed answer contains no Japanese';

	const sentence = item.sentence ?? '';
	const blanks = countBlanks(sentence);
	if (item.form === 'free') {
		return blanks > 0 ? 'free_has_blank: a free typed item has a blank in its sentence' : null;
	}
	if (item.sentence === undefined) return 'cloze_no_sentence: a cloze item needs a sentence';
	if (blanks !== 1) return `cloze_blank_count: ${blanks} blanks, need exactly 1`;
	for (const a of item.accepted) {
		const bad = cleanFillProblem(fillBlank(sentence, a));
		if (bad) return `cloze_unclean_fill: filling "${a}" leaves ${bad}`;
	}
	const answer = normalizeAnswer(item.answer);
	if (answer.length >= 2 && normalizeAnswer(sentence).includes(answer)) {
		return 'answer_in_prompt: the answer already appears in the sentence';
	}
	return null;
}

/** True when `target` can be built by concatenating every tile exactly once, in some order. */
function isPermutationOfTiles(tiles: string[], target: string): boolean {
	const used = new Array<boolean>(tiles.length).fill(false);
	const go = (rest: string, remaining: number): boolean => {
		if (remaining === 0) return rest === '';
		for (let i = 0; i < tiles.length; i++) {
			if (used[i] || !rest.startsWith(tiles[i])) continue;
			used[i] = true;
			const found = go(rest.slice(tiles[i].length), remaining - 1);
			used[i] = false;
			if (found) return true;
		}
		return false;
	};
	return go(target, tiles.length);
}

function tilesProblem(item: TilesItem): string | null {
	if (item.tiles.length < 3) return `tiles_too_few: ${item.tiles.length} tiles, need at least 3`;
	const tiles = item.tiles.map(normalizeAnswer);
	if (tiles.some((t) => t === '')) return 'tiles_empty: a tile is empty after normalization';
	const accepted = item.accepted.map(normalizeAnswer);
	for (const [i, a] of accepted.entries()) {
		if (!isPermutationOfTiles(tiles, a)) {
			return `tiles_not_reassemblable: accepted "${item.accepted[i]}" cannot be built from the tiles`;
		}
	}
	const displayed = tiles.join('');
	if (accepted.includes(displayed)) {
		return 'tiles_not_shuffled: the displayed order is already a correct answer';
	}
	return null;
}

function claudeProblem(item: ClaudeItem): string | null {
	if (item.expected.length === 0 && !item.free)
		return 'claude_no_expected: a guided item needs exemplar answers';
	if (item.expected.some((e) => e.trim() === '' || !hasJapaneseScript(e))) {
		return 'language: expected answers must be Japanese';
	}
	return null;
}

// --- Coverage keys ---------------------------------------------------------

export function canonicalCoverage(key: string): string {
	return key.startsWith('reading:') ? `reading:${toHiragana(key.slice(8))}` : key;
}

/** The coverage keys a card defines — every one should appear somewhere in the set. */
export function coverageUniverse(card: Card): string[] {
	switch (card.type) {
		case 'word':
			return card.senses.map((s) => `sense:${s.id}`);
		case 'contrast':
			return ['side:a', 'side:b'];
		case 'kanji':
			return [...new Set(card.readings.map((r) => `reading:${toHiragana(r.kana)}`))];
		default:
			return [];
	}
}

function coverageRequired(card: Card, phase: PhaseId): boolean {
	switch (card.type) {
		case 'word':
			return phase === 'understand' || phase === 'sense';
		case 'kanji':
			return phase === 'reading';
		case 'contrast':
			return phase === 'understand' || phase === 'sort';
		default:
			return false;
	}
}

function coverageProblem(card: Card, item: Item): string | null {
	const universe = coverageUniverse(card);
	if (item.coverage === undefined || item.coverage.trim() === '') {
		return coverageRequired(card, item.phase)
			? `coverage_missing_key: ${item.phase} items need a coverage key (${universe.join(', ')})`
			: null;
	}
	if (!universe.includes(canonicalCoverage(item.coverage))) {
		return `coverage_unknown_key: ${item.coverage} is not one of ${universe.join(', ') || '(none for this type)'}`;
	}
	return null;
}

// --- Target presence --------------------------------------------------------

function targetPresenceProblem(card: Card, item: Item): string | null {
	// Claude-graded items have free answers; Set phrase Situation items may
	// legitimately have another phrase as the answer.
	if (item.kind === 'claude') return null;
	if (card.type === 'set_phrase' && item.phase === 'situation') return null;

	const span = normalizeAnswer(item.targetSpan);
	if (span === '') return 'target_span_empty: targetSpan is empty after normalization';
	const haystack = [
		item.sentence ?? '',
		...(item.kind === 'mc' ? item.options.map((o) => o.text) : []),
		...(item.kind === 'typed'
			? [
					item.answer,
					...item.accepted,
					...(item.sentence ? [fillBlank(item.sentence, item.answer)] : [])
				]
			: []),
		...(item.kind === 'tiles' ? [item.tiles.join(''), ...item.accepted] : [])
	];
	return haystack.some((h) => normalizeAnswer(h).includes(span))
		? null
		: `target_missing: "${item.targetSpan}" does not appear in the item`;
}

// --- Dedupe keys -----------------------------------------------------------

const MIN_DEDUPE_LENGTH = 3;

/** Sentences an item shows or teaches — what we compare to catch repeats. */
function contentKeys(item: Item): string[] {
	const raw: string[] = [];
	if (item.sentence) raw.push(item.sentence);
	if (item.kind === 'typed' && item.sentence) raw.push(fillBlank(item.sentence, item.answer));
	if (item.kind === 'tiles') raw.push(...item.accepted);
	return raw.map(normalizeAnswer).filter((k) => k.length >= MIN_DEDUPE_LENGTH);
}

/** Sentences the learner has just seen on the card. */
export function cardModelSentences(card: Card): string[] {
	const sentences = [...card.modelSentences];
	if (card.type === 'word') sentences.push(...card.senses.map((s) => s.example));
	if (card.type === 'contrast') sentences.push(...card.minimalPair);
	return sentences;
}

// --- Set-level rules --------------------------------------------------------

function setIssues(
	card: Card,
	spec: PhaseSpec[],
	valid: Item[],
	prior: Item[],
	stage: 1 | 2 | undefined
): SetIssue[] {
	const issues: SetIssue[] = [];
	const primaries = valid.filter((i) => !i.spare);

	for (const p of spec) {
		if (stage !== undefined && p.stage !== stage) continue;
		const n = primaries.filter((i) => i.phase === p.id).length;
		if (n < p.min) {
			issues.push({
				code: 'phase_below_minimum',
				phase: p.id,
				detail: `${n} valid items, need at least ${p.min}`
			});
		}
	}

	// Coverage and balance concern the stage-1 (comprehension) phases.
	if (stage === 2) return issues;
	const all = [...prior, ...valid].filter((i) => !i.spare);

	const universe = coverageUniverse(card);
	const keyed = all
		.filter((i) => i.coverage !== undefined)
		.map((i) => canonicalCoverage(i.coverage!));
	for (const key of universe) {
		if (!keyed.includes(key)) {
			issues.push({ code: 'coverage_missing', detail: `nothing covers ${key}` });
		}
	}
	if (universe.length >= 2 && keyed.length >= 2) {
		const cap = Math.ceil(keyed.length / 2);
		for (const key of universe) {
			const count = keyed.filter((k) => k === key).length;
			if (count > cap) {
				issues.push({
					code: 'coverage_dominant',
					detail: `${key} takes ${count} of ${keyed.length} keyed items (max ${cap})`
				});
			}
		}
	}

	if (card.type === 'contrast') {
		const sort = all.filter((i) => i.phase === 'sort');
		const a = sort.filter((i) => i.coverage === 'side:a').length;
		const b = sort.filter((i) => i.coverage === 'side:b').length;
		if (sort.length > 0 && Math.abs(a - b) > 1) {
			issues.push({
				code: 'sort_unbalanced',
				phase: 'sort',
				detail: `Sort answers split ${a}:${b} between the sides`
			});
		}
	}

	if (card.type === 'set_phrase') {
		const situation = all.filter((i): i is McItem => i.phase === 'situation' && i.kind === 'mc');
		const hasNonTarget = situation.some((i) => {
			const correct = i.options.find((o) => o.correct);
			return (
				correct !== undefined &&
				!normalizeAnswer(correct.text).includes(normalizeAnswer(i.targetSpan))
			);
		});
		if (situation.length > 0 && !hasNonTarget) {
			issues.push({
				code: 'no_non_target_situation',
				phase: 'situation',
				detail: 'every Situation answer is the target, so "always pick the target" would pass'
			});
		}
	}
	return issues;
}
