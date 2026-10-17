import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { error } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { GRADING_MODEL } from '$lib/server/claude-shared';
import { logError } from '$lib/server/logger';
import { failedPhases, regenerationPlan, validateStage } from '$lib/target-practice/generation';
import type {
	GenerateResponse,
	GenerationStage,
	RegenerationRequest
} from '$lib/target-practice/generation';
import { targetKey } from '$lib/target-practice/lookup';
import type { Card, Item } from '$lib/target-practice/types';
import type { SetIssue, DroppedItem } from '$lib/target-practice/validate-items';
import { UsageCapError, callClaude } from './claude-call';
import { generationPrompt } from './generation-prompts';
import { recordPracticedTarget } from './history-repository';
import { limitOutcome } from './limit-outcome';
import { generationSchemaFor, toRawItems } from './schemas';
import type { UsageKind } from './usage';

/**
 * The generation stages (design doc §6): one Claude call per stage, validated
 * by validateItems, short phases refilled from spares and then — once — by a
 * second, smaller call; stage 1 additionally records the target in the
 * learner's recents once it validates.
 *
 * Budgets are set so the worst case fits the route's maxDuration (120s): the
 * client uses maxRetries 0 (an SDK retry would repeat a whole timeout), so a
 * stage is at most one full call plus one regeneration. The UI does the one
 * automatic retry of a failed stage, as a fresh request with `retry: true`.
 */

export const GENERATE_MAX_DURATION_S = 120;

/**
 * Output budgets are ~4x the estimated payload (design doc §6: ~1.5k-2.2k
 * tokens). Truncated JSON makes `parse` throw and wastes the whole spend, so
 * the headroom is deliberate.
 */
const STAGE_TIMEOUT_MS: Record<GenerationStage, number> = { 1: 50_000, 2: 70_000 };
const STAGE_MAX_TOKENS = 6000;
const REGEN_TIMEOUT_MS = 40_000;
const REGEN_MAX_TOKENS = 3000;

export interface GenerateParams {
	stage: GenerationStage;
	/** Already run through validateCard by the route. */
	card: Card;
	/** The client is retrying a failed stage: not a new session. */
	retry: boolean;
	/** Sentences from earlier rounds ("Another round"), bounded by the route. */
	avoid: string[];
}

/** Sentences an item shows, for telling the regeneration what already exists. */
function sentencesOf(items: Item[]): string[] {
	return items.flatMap((i) =>
		i.kind === 'tiles' ? i.accepted.slice(0, 1) : i.sentence ? [i.sentence] : []
	);
}

async function failGenerate(
	stage: GenerationStage,
	e: unknown,
	context: Record<string, unknown>
): Promise<never> {
	// A response that parses as JSON but not as our schema is a model failure too.
	if (e instanceof Anthropic.AnthropicError || e instanceof ZodError) {
		await logError(`target-practice/generate/stage${stage}`, e, context);
		error(502, 'The practice generator is temporarily unavailable — please try again.');
	}
	throw e;
}

async function runModel(opts: {
	supabase: SupabaseClient;
	userId: number;
	kind: UsageKind;
	card: Card;
	stage: GenerationStage;
	attempt: number;
	avoid: string[];
	regenerate?: RegenerationRequest[];
}): Promise<Record<string, unknown>[]> {
	const { supabase, userId, kind, card, stage, attempt, avoid, regenerate } = opts;
	const schema = generationSchemaFor(stage);
	const { system, user } = generationPrompt({ card, stage, avoid, regenerate });
	const response = await callClaude({
		supabase,
		userId,
		kind,
		timeoutMs: regenerate ? REGEN_TIMEOUT_MS : STAGE_TIMEOUT_MS[stage],
		maxRetries: 0,
		call: (client) =>
			client.messages.parse({
				model: GRADING_MODEL,
				max_tokens: regenerate ? REGEN_MAX_TOKENS : STAGE_MAX_TOKENS,
				thinking: { type: 'disabled' },
				output_config: { format: zodOutputFormat(schema) },
				system,
				messages: [{ role: 'user', content: user }]
			})
	});
	return toRawItems(stage, attempt, schema.parse(response.parsed_output));
}

/** How much of a dropped item is kept in the log: enough to see what the model wrote. */
const SAMPLE_CHARS = 600;

/**
 * Dropped reasons (with a truncated copy of the item) and leftover set issues
 * are how the prompts get tuned.
 */
async function logOutcome(
	stage: GenerationStage,
	attempt: number,
	card: Card,
	raw: unknown[],
	dropped: DroppedItem[],
	setIssues: SetIssue[]
): Promise<void> {
	if (dropped.length === 0 && setIssues.length === 0) return;
	const withSample = dropped.map((d) => ({
		...d,
		item: JSON.stringify(raw.find((r) => (r as { id?: unknown }).id === d.id)).slice(
			0,
			SAMPLE_CHARS
		)
	}));
	// What the model actually sent, by phase — an empty phase with nothing dropped
	// means the model left it out, which the reasons alone can't show.
	const received: Record<string, number> = {};
	for (const r of raw) {
		const { phase, spare } = r as { phase?: unknown; spare?: unknown };
		const key = `${String(phase)}${spare ? ' (spare)' : ''}`;
		received[key] = (received[key] ?? 0) + 1;
	}
	await logError('target-practice/generate/outcome', new Error('generation issues'), {
		stage,
		attempt,
		received,
		type: card.type,
		target: card.target,
		dropped: withSample,
		setIssues
	});
}

export async function generateStage(
	supabase: SupabaseClient,
	userId: number,
	params: GenerateParams
): Promise<GenerateResponse> {
	const { stage, card, retry, avoid } = params;
	const context = { type: card.type, target: card.target };

	// Stage 1 opens a session; stage 2 and any retry only spend against the token ceiling.
	const kind: UsageKind = stage === 1 && !retry ? 'session' : 'ceiling';

	let raw: Record<string, unknown>[];
	try {
		raw = await runModel({ supabase, userId, kind, card, stage, attempt: 1, avoid });
	} catch (e) {
		if (e instanceof UsageCapError) return limitOutcome(e);
		return failGenerate(stage, e, context);
	}

	let result = validateStage(card, raw, { stage, avoidSentences: avoid });
	await logOutcome(stage, 1, card, raw, result.dropped, result.setIssues);

	// Refill what is still short (a phase below its minimum, a missing coverage
	// key, ...) with one smaller call. Failing here is not fatal: the learner
	// gets the first result and its setIssues, and the UI treats a short phase as failed.
	let regenerated = false;
	const plan = regenerationPlan(card, stage, result.valid, result.setIssues);
	if (plan.length > 0) {
		try {
			const extra = await runModel({
				supabase,
				userId,
				kind: 'ceiling',
				card,
				stage,
				attempt: 2,
				avoid: [...avoid, ...sentencesOf(result.valid)],
				regenerate: plan
			});
			regenerated = true;
			// Existing valid items first, so on a clash the earlier one wins.
			const combined = [...result.valid, ...extra];
			const second = validateStage(card, combined, { stage, avoidSentences: avoid });
			await logOutcome(stage, 2, card, combined, second.dropped, second.setIssues);
			result = second;
		} catch (e) {
			if (!(e instanceof UsageCapError)) {
				await logError(`target-practice/generate/stage${stage}-regenerate`, e, {
					...context,
					plan
				});
			}
		}
	}

	// Only a usable stage 1 counts as practising the target. Best-effort: a
	// history failure must never cost the learner their session.
	if (stage === 1 && failedPhases(result.setIssues).length === 0) {
		try {
			await recordPracticedTarget(supabase, userId, card);
		} catch (e) {
			await logError('target-practice/generate/history', e, {
				...context,
				targetKey: targetKey(card)
			});
		}
	}

	return { status: 'ok', stage, items: result.valid, setIssues: result.setIssues, regenerated };
}
