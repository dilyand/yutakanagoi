import { z } from 'zod';
import { TARGET_MASK, normalizeAnswer } from '$lib/target-practice/normalize';
import { spareQuota } from '$lib/target-practice/generation';
import type { GenerationStage, RegenerationRequest } from '$lib/target-practice/generation';
import { PHASE_KINDS, skeletonFor } from '$lib/target-practice/skeleton';
import { TARGET_TYPES, CONTRAST_KINDS } from '$lib/target-practice/types';
import { MAX_INSTRUCTION_JAPANESE_RUN } from '$lib/target-practice/validate-items';
import type { Card, PhaseId, TargetType } from '$lib/target-practice/types';
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
 * - One REQUIRED array per phase of the stage, built from the skeleton
 *   (`{items: {understand: [...], sense: [...]}, spares: {...}}`). The first real
 *   runs showed the model closing a flat `items` array after the first phase and
 *   moving on to `spares`, so later phases went missing (most requests needed a
 *   regeneration). With a key per phase the constrained decoder has to open every
 *   array, and the per-item `phase` field (and the "mc item labelled use" slip)
 *   disappears with it.
 * - Which item shapes a phase takes follows PHASE_KINDS, so unions only remain
 *   where a phase really allows two (Produce: typed | tiles; Grammar's Contrast:
 *   mc | typed). Stage 1 has none.
 * - The model never emits `id`, `kind`, `phase` or `spare`. `toRawItems` assigns
 *   ids from the stage, attempt, phase and position (so the two parallel stages
 *   can never collide), takes the phase from the key, derives the kind from which
 *   union member matched, and marks everything under `spares` as a spare.
 * - No optional fields: an absent text field is "" and becomes `undefined` in
 *   `toRawItems`. A required-but-empty field (a missing `kana` on a sentence,
 *   say) still reaches validateItems and is dropped there with a reason.
 * - `form` and tags are plain strings with the allowed values spelled out in
 *   `.describe()`; the transform would drop a `z.enum`, and validateItems is the
 *   real check.
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
	instruction: text().describe('English meaning of the sentence to build; no Japanese script'),
	targetSpan: text().describe('the target exactly as it appears in the answer'),
	rationale: text().describe('English explanation of the answer'),
	tiles: z
		.array(text())
		.describe('the tiles in the order of ONE correct sentence (the server shuffles them)'),
	accepted: z.array(text()).describe('every valid full sentence made from all the tiles')
});

const WireClaude = z.object({
	instruction: text().describe('English task wording, no Japanese script'),
	sentence: text().describe('Japanese prompt sentence or dialogue; empty string if none'),
	kana: text().describe('kana line of the sentence with the target masked; empty if no sentence'),
	targetSpan: text().describe('the target as it would appear in a good answer'),
	rationale: text().describe('English explanation of what a good answer does'),
	expected: z.array(text()).describe('exemplar Japanese answers; empty for a free-writing item'),
	free: z.boolean().describe('true only for the "write your own sentence" item')
});

/** What a parsed generation response looks like: wire items grouped by phase. */
export interface WirePayload {
	items: Record<string, object[]>;
	spares?: Record<string, object[]>;
}

/** The item shapes a phase takes, from PHASE_KINDS. */
function phaseItems(phase: PhaseId) {
	const kinds = PHASE_KINDS[phase];
	const member = (kind: (typeof kinds)[number]) =>
		({ mc: WireMc, typed: WireTyped, tiles: WireTiles, claude: WireClaude })[kind];
	const members = kinds.map(member);
	return members.length === 1
		? z.array(members[0])
		: z.array(z.union(members as unknown as [z.ZodType, z.ZodType]));
}

/**
 * The structured-output schema for one generation call: a required array per
 * phase of `stage`, plus (unless this is a regeneration) a required array per
 * phase that has a spare quota. A regeneration passes `regenerate` and gets only
 * the phases it asked for, no spares.
 */
export function generationSchemaFor(
	card: Card,
	stage: GenerationStage,
	regenerate?: RegenerationRequest[]
): z.ZodType<WirePayload> {
	const spec = skeletonFor(card).filter(
		(p) => p.stage === stage && (!regenerate || regenerate.some((r) => r.phase === p.id))
	);
	const items = z.object(
		Object.fromEntries(
			spec.map((p) => {
				const count = regenerate?.find((r) => r.phase === p.id)?.need ?? p.count;
				return [p.id, phaseItems(p.id).describe(`the "${p.id}" items: ${count} of them`)];
			})
		)
	);
	const quota = regenerate ? [] : spareQuota(card, stage);
	if (quota.length === 0) return z.object({ items }) as unknown as z.ZodType<WirePayload>;
	const spares = z.object(
		Object.fromEntries(
			quota.map((q) => [
				q.phase,
				phaseItems(q.phase).describe(`${q.count} reserve "${q.phase}" items`)
			])
		)
	);
	return z.object({ items, spares }) as unknown as z.ZodType<WirePayload>;
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

const LONG_JAPANESE_RUN = new RegExp(
	`[\\p{Script=Han}\\p{Script=Hiragana}\\p{Script=Katakana}ー]{${MAX_INSTRUCTION_JAPANESE_RUN + 1},}`,
	'u'
);

/**
 * "Combine the two sentences" items: the model writes the Japanese into the
 * instruction as well as into `sentence`, despite being told not to, and the
 * validator drops the item (3 of 11 drops in the slice-5 real run). When the
 * Japanese is also in `sentence`, nothing is lost by cutting the instruction at
 * its first Japanese run and removing the dangling "First sentence:" label — a
 * repair, unlike guessing. Without a `sentence` there is nothing safe to do and
 * the item is left for validateItems to drop.
 */
export function repairInstruction(instruction: unknown, sentence: unknown): unknown {
	if (typeof instruction !== 'string' || typeof sentence !== 'string') return instruction;
	if (sentence.trim() === '') return instruction;
	const run = LONG_JAPANESE_RUN.exec(instruction);
	if (!run) return instruction;
	const cut = instruction
		.slice(0, run.index)
		.replace(/[\s"'「『(（]+$/u, '')
		// A dangling "First sentence:" label after a sentence end, or a lone colon.
		.replace(/(?<=[.!?])\s+[A-Za-z0-9 ]{1,30}:$/, '')
		.replace(/[\s:]+$/, '')
		.trim();
	return /[A-Za-z]{3,}/.test(cut) ? cut : instruction;
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

function toRawItem(wire: Wire, phase: string, id: string, spare: boolean): Record<string, unknown> {
	const base = {
		id,
		phase,
		...(spare ? { spare: true } : {}),
		...present(
			{
				...wire,
				kana: repairMask(wire.kana),
				instruction: repairInstruction(wire.instruction, wire.sentence)
			},
			['instruction', 'sentence', 'kana']
		),
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
 * primaries first (in the schema's phase order), then spares. Ids look like
 * `s1a1-understand0` / `s1a1-understandx0` (stage, attempt — a regeneration is
 * attempt 2 — phase, primary or spare, position within the phase).
 */
export function toRawItems(
	stage: GenerationStage,
	attempt: number,
	parsed: WirePayload
): Record<string, unknown>[] {
	const prefix = `s${stage}a${attempt}`;
	const flatten = (byPhase: Record<string, object[]> | undefined, spare: boolean) =>
		Object.entries(byPhase ?? {}).flatMap(([phase, wires]) =>
			wires.map((w, i) =>
				toRawItem(w as Wire, phase, `${prefix}-${phase}${spare ? 'x' : ''}${i}`, spare)
			)
		);
	return [...flatten(parsed.items, false), ...flatten(parsed.spares, true)];
}

// --- Grading (the grade route) ---------------------------------------------

/**
 * One verdict per graded input, in order. `correct` is a plain boolean (no
 * enum to drop); `checkGradeResults` turns anything malformed or missing into
 * the neutral "couldn't check" result rather than guessing.
 */
export const GradeResult = z.object({
	results: z.array(
		z.object({
			correct: z.boolean().describe('true only if the answer is acceptable for the task'),
			feedback: z
				.string()
				.describe('one or two English sentences for the learner; Japanese in script, never romaji')
		})
	)
});
