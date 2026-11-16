import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { REVIEW_EFFORT, REVIEW_MODEL, REVIEW_THINKING } from '$lib/server/claude-shared';
import { checkVerifyResults } from '$lib/target-practice/verification';
import type { VerifyFailure } from '$lib/target-practice/verification';
import type { Card, McItem } from '$lib/target-practice/types';
import { callClaude } from './claude-call';
import { VerifyResult } from './schemas';
import { verifyContrastPrompt } from './verification-prompts';

/** ~60 tokens a result, with headroom. */
const MAX_TOKENS_PER_ITEM = 150;
// Headroom for the (low-effort) thinking the review model does before it answers.
const BASE_MAX_TOKENS = 800;
export const VERIFY_TIMEOUT_MS = 25_000;

/**
 * Asks the review model whether each spot-the-error Contrast item really has
 * exactly the one clear error it claims (and three clearly sound sentences).
 * Returns the items to drop. Throws on a model/SDK failure or a usage cap — the
 * caller fails OPEN (keeps the items) and logs, since a verification outage must
 * never make generation worse than it was without the pass.
 */
export async function verifyContrastItems(
	supabase: SupabaseClient,
	userId: number,
	card: Card,
	items: McItem[]
): Promise<VerifyFailure[]> {
	if (items.length === 0) return [];
	const { system, user } = verifyContrastPrompt(card, items);
	const response = await callClaude({
		supabase,
		userId,
		kind: 'ceiling',
		timeoutMs: VERIFY_TIMEOUT_MS,
		maxRetries: 0,
		call: (client) =>
			client.messages.parse({
				model: REVIEW_MODEL,
				max_tokens: BASE_MAX_TOKENS + MAX_TOKENS_PER_ITEM * items.length,
				thinking: REVIEW_THINKING,
				output_config: { effort: REVIEW_EFFORT, format: zodOutputFormat(VerifyResult) },
				system,
				messages: [{ role: 'user', content: user }]
			})
	});
	return checkVerifyResults(response.parsed_output, items);
}
