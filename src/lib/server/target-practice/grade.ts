import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { error } from '@sveltejs/kit';
import { ZodError } from 'zod';
import { GRADING_MODEL } from '$lib/server/claude-shared';
import { logError } from '$lib/server/logger';
import { checkGradeResults } from '$lib/target-practice/grade';
import type { GradeInput, GradeResponse } from '$lib/target-practice/grade';
import type { Card } from '$lib/target-practice/types';
import { UsageCapError, callClaude } from './claude-call';
import { gradePrompt } from './grade-prompts';
import { limitOutcome } from './limit-outcome';
import { GradeResult } from './schemas';

/**
 * Fallback and Use-phase grading (design doc §7). Judgment, so GRADING_MODEL
 * (the 0.5.0 comparison found Haiku too strict on loosely-phrased correct
 * answers). Kind 'ceiling': grading is never a new session, but it is bounded
 * by the daily token ceiling; a cap hit comes back as a normal `limit`
 * outcome, which the client treats like any failure — the neutral "couldn't
 * check this one" path. A model failure is a logged 502.
 */

/** ~60-100 tokens of feedback per item, with headroom. */
const MAX_TOKENS_PER_ITEM = 250;
const BASE_MAX_TOKENS = 100;
const TIMEOUT_MS = 25_000;

export async function gradeAnswers(
	supabase: SupabaseClient,
	userId: number,
	card: Card,
	inputs: GradeInput[]
): Promise<GradeResponse> {
	const { system, user } = gradePrompt(card, inputs);
	try {
		const response = await callClaude({
			supabase,
			userId,
			kind: 'ceiling',
			timeoutMs: TIMEOUT_MS,
			call: (client) =>
				client.messages.parse({
					model: GRADING_MODEL,
					max_tokens: BASE_MAX_TOKENS + MAX_TOKENS_PER_ITEM * inputs.length,
					thinking: { type: 'disabled' },
					output_config: { format: zodOutputFormat(GradeResult) },
					system,
					messages: [{ role: 'user', content: user }]
				})
		});
		return {
			status: 'ok',
			results: checkGradeResults(response.parsed_output, inputs.length)
		};
	} catch (e) {
		if (e instanceof UsageCapError) return limitOutcome(e);
		if (e instanceof Anthropic.AnthropicError || e instanceof ZodError) {
			await logError('target-practice/grade', e, { type: card.type, count: inputs.length });
			error(502, 'Grading is temporarily unavailable.');
		}
		throw e;
	}
}
