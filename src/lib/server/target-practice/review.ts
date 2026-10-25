import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { REVIEW_EFFORT, REVIEW_MODEL, REVIEW_THINKING } from '$lib/server/claude-shared';
import type { GradeInput, GradeVerdict } from '$lib/target-practice/grade';
import { checkReviewResults } from '$lib/target-practice/verification';
import type { ReviewVerdict } from '$lib/target-practice/verification';
import type { Card } from '$lib/target-practice/types';
import { callClaude } from './claude-call';
import { ReviewResult } from './schemas';
import { reviewPrompt } from './verification-prompts';

const MAX_TOKENS_PER_ITEM = 250;
// Headroom for the (low-effort) thinking the review model does before it answers.
const BASE_MAX_TOKENS = 800;
export const REVIEW_TIMEOUT_MS = 25_000;

/**
 * The second look at rejected answers: the review model decides independently
 * whether a native would accept each one (the first reason is shown to it as a
 * claim to check, not a verdict to follow). One entry per rejected item, null
 * where the model gave nothing usable. Throws on a model/SDK failure or a usage
 * cap; the caller keeps the first verdicts in that case.
 */
export async function reviewRejections(
	supabase: SupabaseClient,
	userId: number,
	card: Card,
	rejected: { input: GradeInput; first: GradeVerdict }[]
): Promise<(ReviewVerdict | null)[]> {
	if (rejected.length === 0) return [];
	const { system, user } = reviewPrompt(card, rejected);
	const response = await callClaude({
		supabase,
		userId,
		kind: 'ceiling',
		timeoutMs: REVIEW_TIMEOUT_MS,
		maxRetries: 0,
		call: (client) =>
			client.messages.parse({
				model: REVIEW_MODEL,
				max_tokens: BASE_MAX_TOKENS + MAX_TOKENS_PER_ITEM * rejected.length,
				thinking: REVIEW_THINKING,
				output_config: { effort: REVIEW_EFFORT, format: zodOutputFormat(ReviewResult) },
				system,
				messages: [{ role: 'user', content: user }]
			})
	});
	return checkReviewResults(response.parsed_output, rejected.length);
}
