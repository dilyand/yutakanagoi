import { z } from 'zod';
import { TARGET_MASK, normalizeAnswer } from '$lib/target-practice/normalize';
import { TARGET_TYPES, CONTRAST_KINDS } from '$lib/target-practice/types';
import type { TargetType } from '$lib/target-practice/types';
import type { ModelCardResult } from '$lib/target-practice/lookup';

/**
 * Zod schemas for the lookup step's structured output (passed to
 * `zodOutputFormat`). They are written around what the Anthropic structured-
 * output transform actually keeps — checked against the SDK, see
 * schemas.test.ts:
 *
 * - No `z.literal` / `z.enum` — this SDK version's transform drops `enum` and
 *   `const` (demoted to `description` text), so the API wouldn't enforce
 *   them, and a bad value would make `messages.parse` throw instead of
 *   reaching validateCard's graceful path. Enum-like fields are plain strings
 *   with the allowed values spelled out in `.describe()`.
 * - No `z.tuple` (loses its items), no `.int()` (adds min/max noise), no
 *   `.min()/.max()` on arrays beyond what the transform keeps. Counts and
 *   "exactly two" are enforced after the fact by validateCard — these schemas
 *   only fix the *shape*.
 * - The card result is a two-way union discriminated by shape, not by an `ok`
 *   flag, wrapped in an object so the root stays a plain object.
 * - The model never emits `ok`, `type` or `target`: the server re-attaches
 *   them (lookup.ts `checkCardResult`), so they can't drift.
 */

// --- Candidates ----------------------------------------------------------

export const CandidatesResult = z.object({
	candidates: z.array(
		z.object({
			target: z.string(),
			reading: z.string(),
			gloss: z.string()
		})
	)
});

// --- Card bodies (everything validateCard needs minus ok/type/target) -----

const modelSentences = z.array(z.string());

const WordBody = z.object({
	reading: z.string(),
	rule: z.string(),
	modelSentences,
	senses: z.array(z.object({ id: z.number(), gloss: z.string(), example: z.string() })),
	forms: z.array(z.string()),
	lessCommonSenses: z.number()
});

const KanjiBody = z.object({
	rule: z.string(),
	modelSentences,
	meaning: z.string(),
	readings: z.array(
		z.object({
			kana: z.string(),
			kind: z.string().describe('"on" or "kun"'),
			okurigana: z.string().optional(),
			rare: z.boolean()
		})
	),
	compounds: z.array(z.object({ word: z.string(), reading: z.string(), gloss: z.string() }))
});

const SetPhraseBody = z.object({
	reading: z.string(),
	rule: z.string(),
	modelSentences,
	meaning: z.string(),
	uses: z.array(z.string()),
	variants: z.array(z.object({ text: z.string(), note: z.string() })),
	register: z.string(),
	watchOuts: z.array(z.string())
});

const GrammarBody = z.object({
	reading: z.string(),
	rule: z.string(),
	modelSentences,
	form: z.string(),
	use: z.string(),
	watchOut: z.string(),
	neighbours: z.array(z.string())
});

const ContrastBody = z.object({
	rule: z.string(),
	modelSentences,
	axis: z.string(),
	// Arrays, not tuples (see above): validateCard enforces exactly two.
	sides: z.array(z.object({ form: z.string(), reading: z.string(), meaning: z.string() })),
	commonMistake: z.string(),
	minimalPair: z.array(z.string()),
	contrastKind: z.string().describe(`one of: ${CONTRAST_KINDS.join(', ')}`)
});

/** `'none'`: the model has no better type to suggest. */
const SUGGESTED_TYPES = [...TARGET_TYPES, 'none'];

const Rejection = z.object({
	reason: z.string(),
	suggestedType: z.string().describe(`one of: ${SUGGESTED_TYPES.join(', ')}`)
});

function cardResultSchema<B extends z.ZodType>(body: B) {
	return z.object({ result: z.union([z.object({ card: body }), Rejection]) });
}

/** One schema per type, so each card call's grammar only describes its own card. */
export const CARD_RESULT_SCHEMAS = {
	word: cardResultSchema(WordBody),
	kanji: cardResultSchema(KanjiBody),
	set_phrase: cardResultSchema(SetPhraseBody),
	grammar: cardResultSchema(GrammarBody),
	contrast: cardResultSchema(ContrastBody)
} as const satisfies Record<TargetType, z.ZodType>;

export function cardResultSchemaFor(type: TargetType) {
	return CARD_RESULT_SCHEMAS[type];
}

/** Flattens the union back into the shape lookup.ts's checkCardResult takes. */
export function toModelCardResult(parsed: {
	result: { card: unknown } | { reason: string; suggestedType: string };
}): ModelCardResult {
	const { result } = parsed;
	if ('card' in result) return { ok: true, card: result.card as Record<string, unknown> };
	return { ok: false, reason: result.reason, suggestedType: result.suggestedType };
}

// --- Generated items (stages 1 and 2) --------------------------------------

/*
 * The wire format differs from `Item` on purpose, to stay inside the
 * structured-output limits (16 union-typed / 24 optional parameters) and to cut
 * what the model can get wrong:
 *
 * - The model never emits `id`, `kind` or `spare`. `toRawItems` assigns ids
 *   from the stage, attempt and array position (so the two parallel stages can
 *   never collide), derives the kind from which member of the union matched,
 *   and marks everything in `spares` as a spare.
 * - No optional fields: an absent text field is "" and becomes `undefined` in
 *   `toRawItems`. A required-but-empty field (a missing `kana` on a sentence,
 *   say) still reaches validateItems and is dropped there with a reason.
 * - `phase`, `form` and tags are plain strings with the allowed values spelled
 *   out in `.describe()`; the transform would drop a `z.enum`, and validateItems
 *   is the real check.
 * - Stage 1 is all multiple choice (comprehension phases), so it has no kind
 *   union at all. Stage 2 has one 4-way union per array, distinguished by shape
 *   (`options` | `answer` | `tiles` | `expected`).
 */

// A factory, not a shared instance: zod's JSON-schema output extracts a reused
// schema instance into a `$ref` and DROPS the per-field `.describe()` text,
// which here is the only place the model is told what each field is for.
const text = () => z.string();

const WireOption = z.object({
	text: text(),
	correct: z.boolean(),
	tag: text().describe('the distractor tag for a wrong option; empty string on the correct option')
});

const WireMc = z.object({
	phase: text().describe('the phase id this item belongs to'),
	instruction: text().describe('English task wording, no Japanese script; empty string if none'),
	sentence: text().describe('Japanese prompt sentence or dialogue; empty string if none'),
	kana: text().describe('kana line of the sentence with the target masked; empty if no sentence'),
	focus: text().describe('substring of the sentence to highlight; empty string if none'),
	targetSpan: text().describe('the target exactly as it appears in this item'),
	coverage: text().describe('coverage key (sense:<id>, side:a|b, reading:<kana>), or empty string'),
	rationale: text().describe('English explanation of why the answer is right'),
	options: z.array(WireOption)
});

const WireTyped = z.object({
	phase: text().describe('the phase id this item belongs to'),
	instruction: text().describe('English task wording, no Japanese script; empty string if none'),
	sentence: text().describe(
		'Japanese sentence with one ＿＿ blank for a cloze; empty for a free item'
	),
	kana: text().describe('kana line of the sentence with the target masked; empty if no sentence'),
	focus: text().describe('substring of the sentence to highlight; empty string if none'),
	cue: text().describe('short cue such as （来る）; empty string if none'),
	targetSpan: text().describe('the target exactly as it appears in this item'),
	rationale: text().describe('English explanation of why the answer is right'),
	hint: text().describe('one-line English hint shown after a first miss'),
	form: text().describe('"cloze" (one blank in the sentence) or "free"'),
	answer: text().describe('the canonical Japanese answer'),
	accepted: z.array(text()).describe('every acceptable answer, including the canonical one')
});

const WireTiles = z.object({
	phase: text().describe('the phase id this item belongs to'),
	instruction: text().describe('English meaning of the sentence to build; no Japanese script'),
	targetSpan: text().describe('the target exactly as it appears in the answer'),
	rationale: text().describe('English explanation of the answer'),
	tiles: z
		.array(text())
		.describe('the tiles in the order of ONE correct sentence (the server shuffles them)'),
	accepted: z.array(text()).describe('every valid full sentence made from all the tiles')
});

const WireClaude = z.object({
	phase: text().describe('the phase id this item belongs to'),
	instruction: text().describe('English task wording, no Japanese script'),
	sentence: text().describe('Japanese prompt sentence or dialogue; empty string if none'),
	kana: text().describe('kana line of the sentence with the target masked; empty if no sentence'),
	targetSpan: text().describe('the target as it would appear in a good answer'),
	rationale: text().describe('English explanation of what a good answer does'),
	expected: z.array(text()).describe('exemplar Japanese answers; empty for a free-writing item'),
	free: z.boolean().describe('true only for the "write your own sentence" item')
});

/** Stage 1: the comprehension phases. All multiple choice. */
export const Stage1Result = z.object({
	items: z.array(WireMc),
	spares: z.array(WireMc)
});

const Stage2Item = z.union([WireTyped, WireTiles, WireClaude, WireMc]);

/** Stage 2: Produce, Use and (Grammar) Contrast. */
export const Stage2Result = z.object({
	items: z.array(Stage2Item),
	spares: z.array(Stage2Item)
});

export type GenerationStage = 1 | 2;

export function generationSchemaFor(stage: GenerationStage) {
	return stage === 1 ? Stage1Result : Stage2Result;
}

type Wire = Record<string, unknown>;

/** Copies a wire field only when it is a non-blank string; "" means absent. */
function present(source: Wire, keys: string[]): Wire {
	const out: Wire = {};
	for (const key of keys) {
		const v = source[key];
		if (typeof v === 'string' && v.trim() !== '') out[key] = v;
	}
	return out;
}

/**
 * The model sometimes writes the mask as 〇〇〇 or 〇. The mask is exactly
 * TARGET_MASK, so a run of 〇 is normalised to it — a harmless repair, unlike
 * guessing where a missing or misplaced mask should have gone.
 */
function repairMask(kana: unknown): unknown {
	return typeof kana === 'string' ? kana.replace(/〇+/g, TARGET_MASK) : kana;
}

/** Small deterministic PRNG (mulberry32), so a given item always shuffles the same way. */
function seededRandom(seed: string): () => number {
	let h = 1779033703 ^ seed.length;
	for (let i = 0; i < seed.length; i++) {
		h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
		h = (h << 13) | (h >>> 19);
	}
	let a = h >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * The model lists tiles in the order of a correct sentence (what it does
 * naturally — asked to shuffle, it kept the right order in most items), and
 * the server shuffles them: deterministically per item id, and never into an
 * order that spells an accepted sentence. If no such order turns up (tiles
 * that are all alike), the original is returned and validateItems drops it.
 */
export function shuffleTiles(tiles: string[], accepted: string[], seed: string): string[] {
	if (tiles.length < 3) return tiles;
	const correct = new Set(accepted.map(normalizeAnswer));
	const random = seededRandom(seed);
	for (let attempt = 0; attempt < 50; attempt++) {
		const shuffled = [...tiles];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		if (!correct.has(normalizeAnswer(shuffled.join('')))) return shuffled;
	}
	return tiles;
}

/** Stands in for the model's hint when a translation item had to be salvaged from an empty tile item. */
export const GENERIC_TRANSLATION_HINT =
	'Write the whole sentence yourself, using the target and the meaning given.';

function toRawItem(wire: Wire, id: string, spare: boolean): Record<string, unknown> {
	const base = {
		id,
		phase: wire.phase,
		...(spare ? { spare: true } : {}),
		...present({ ...wire, kana: repairMask(wire.kana) }, ['instruction', 'sentence', 'kana']),
		// Required fields stay as given: validateItems reports them if blank.
		targetSpan: wire.targetSpan,
		rationale: wire.rationale
	};
	if ('options' in wire) {
		return {
			...base,
			kind: 'mc',
			...present(wire, ['focus', 'coverage']),
			options: (wire.options as Wire[]).map((o) => ({
				text: o.text,
				correct: o.correct,
				...present(o, ['tag'])
			}))
		};
	}
	if ('tiles' in wire) {
		// A punctuation-only tile ("、") is dropped: answers are compared with
		// punctuation stripped, so it can only make the item undroppable-looking
		// ("a tile is empty after normalization") without changing what is accepted.
		const tiles = (wire.tiles as string[]).filter((t) => normalizeAnswer(t) !== '');
		// Every real model run produced a "tile" item with NO tiles for an
		// English->Japanese translation (it picked the cheaper union member). The
		// item itself — instruction plus accepted answers — is sound, so it is
		// salvaged as the free typed item it really is. Only the hint is generic.
		if (tiles.length === 0 && (wire.accepted as string[]).length > 0) {
			const accepted = wire.accepted as string[];
			return {
				...base,
				kind: 'typed',
				form: 'free',
				answer: accepted[0],
				accepted,
				hint: GENERIC_TRANSLATION_HINT
			};
		}
		return {
			...base,
			kind: 'tiles',
			tiles: shuffleTiles(tiles, wire.accepted as string[], id),
			accepted: wire.accepted
		};
	}
	if ('answer' in wire) {
		return {
			...base,
			kind: 'typed',
			...present(wire, ['focus', 'cue']),
			form: wire.form,
			answer: wire.answer,
			accepted: wire.accepted,
			hint: wire.hint
		};
	}
	return {
		...base,
		kind: 'claude',
		expected: wire.expected,
		...(wire.free === true ? { free: true } : {})
	};
}

/**
 * Flattens a parsed generation result into the `unknown[]` validateItems takes:
 * primaries first, then spares. Ids look like `s1a1-p0` / `s1a1-x0` (stage,
 * attempt — a regeneration is attempt 2 — primary or spare, array position).
 */
export function toRawItems(
	stage: GenerationStage,
	attempt: number,
	parsed: { items: object[]; spares: object[] }
): Record<string, unknown>[] {
	const prefix = `s${stage}a${attempt}`;
	return [
		...parsed.items.map((w, i) => toRawItem(w as Wire, `${prefix}-p${i}`, false)),
		...parsed.spares.map((w, i) => toRawItem(w as Wire, `${prefix}-x${i}`, true))
	];
}
