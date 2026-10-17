import { z } from 'zod';
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
