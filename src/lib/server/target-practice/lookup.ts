import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { error } from '@sveltejs/kit';
import { GRADING_MODEL } from '$lib/server/claude-shared';
import { logError } from '$lib/server/logger';
import { checkCardResult, validateCandidates } from '$lib/target-practice/lookup';
import type {
	CandidatesResponse,
	CardResponse,
	ConfirmedTarget
} from '$lib/target-practice/lookup';
import type { CardCheck } from '$lib/target-practice/validate-card';
import type { TargetType } from '$lib/target-practice/types';
import { UsageCapError, callClaude } from './claude-call';
import { limitOutcome } from './limit-outcome';
import { cardPrompt, candidatePrompt } from './prompts';
import { CandidatesResult, cardResultSchemaFor, toModelCardResult } from './schemas';

/**
 * The lookup step's Claude calls (design doc §2 steps 2-3): the candidate
 * picker and the target card. Both go through `callClaude` as kind 'lookup',
 * so the daily cap, the output-token ceiling and the kill switch apply; a cap
 * hit comes back as a normal `limit` outcome, anything that went wrong with
 * the model or its output as a logged 502.
 */

const CANDIDATES_MAX_TOKENS = 512;
// A Word or Kanji card is roughly 700-900 output tokens; headroom, not a target.
const CARD_MAX_TOKENS = 2048;
// ~10-12s typical for a card, so the default 20s leaves little room for a slow
// call; the route's maxDuration (60s) is the outer bound.
const CARD_TIMEOUT_MS = 25_000;

/** Maps a model/SDK failure to the shared 502, logging it so outages stay visible. */
async function failLookup(
	step: string,
	e: unknown,
	context: Record<string, unknown>
): Promise<never> {
	if (e instanceof Anthropic.AnthropicError) {
		await logError(`target-practice/lookup/${step}`, e, context);
		error(502, 'The lookup service is temporarily unavailable — please try again.');
	}
	throw e;
}

export async function lookupCandidates(
	supabase: SupabaseClient,
	userId: number,
	type: TargetType,
	input: string
): Promise<CandidatesResponse> {
	const { system, user } = candidatePrompt(type, input);
	try {
		const response = await callClaude({
			supabase,
			userId,
			kind: 'lookup',
			call: (client) =>
				client.messages.parse({
					model: GRADING_MODEL,
					max_tokens: CANDIDATES_MAX_TOKENS,
					thinking: { type: 'disabled' },
					output_config: { format: zodOutputFormat(CandidatesResult) },
					system,
					messages: [{ role: 'user', content: user }]
				})
		});
		const parsed = CandidatesResult.parse(response.parsed_output);
		const { valid, dropped } = validateCandidates(type, parsed.candidates);
		if (dropped.length > 0) {
			// Dropped reasons are how the candidate prompt gets tuned.
			await logError('target-practice/lookup/candidates', new Error('candidates dropped'), {
				type,
				dropped: dropped.map((d) => ({ ...d, entry: parsed.candidates[d.index] }))
			});
		}
		return valid.length > 0 ? { status: 'ok', candidates: valid } : { status: 'none' };
	} catch (e) {
		if (e instanceof UsageCapError) return limitOutcome(e);
		return failLookup('candidates', e, { type });
	}
}

export async function lookupCard(
	supabase: SupabaseClient,
	userId: number,
	confirmed: ConfirmedTarget
): Promise<CardResponse> {
	const { system, user } = cardPrompt(confirmed);
	const schema = cardResultSchemaFor(confirmed.type);

	let checked: CardCheck;
	try {
		const response = await callClaude({
			supabase,
			userId,
			kind: 'lookup',
			timeoutMs: CARD_TIMEOUT_MS,
			call: (client) =>
				client.messages.parse({
					model: GRADING_MODEL,
					max_tokens: CARD_MAX_TOKENS,
					thinking: { type: 'disabled' },
					output_config: { format: zodOutputFormat(schema) },
					system,
					messages: [{ role: 'user', content: user }]
				})
		});
		const parsed = schema.parse(response.parsed_output);
		checked = checkCardResult(toModelCardResult(parsed), confirmed);
	} catch (e) {
		if (e instanceof UsageCapError) return limitOutcome(e);
		return failLookup('card', e, { type: confirmed.type });
	}

	if (checked.status === 'ok') return { status: 'ok', card: checked.card };
	if (checked.status === 'rejected') {
		return { status: 'rejected', reason: checked.reason, suggestedType: checked.suggestedType };
	}
	// Malformed card: log the problems so the prompt can be tuned. No automatic
	// retry — each call spends a lookup, and the logged rate says whether one is
	// worth building.
	await logError('target-practice/lookup/card', new Error('invalid card'), {
		type: confirmed.type,
		target: confirmed.target,
		problems: checked.problems
	});
	error(502, "Couldn't build the card for that — please try again.");
}
