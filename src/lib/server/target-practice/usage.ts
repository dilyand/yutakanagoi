import type { SupabaseClient } from '@supabase/supabase-js';

// Circuit-breaker limits (design: notes/target-practice-design.md §10), not
// billing. The output-token ceiling is the real backstop — it also catches a
// loop that never touches the session/lookup counters. Tune from the token
// totals in target_practice_usage after the first week of real use.
export const USAGE_LIMITS = {
	sessionsPerDay: 5,
	lookupsPerDay: 30,
	outputTokensPerDay: 150_000
} as const;

/**
 * Which counter a Claude call consumes (see the SQL function's comment in
 * 20261017000003_target_practice_usage.sql). 'ceiling' consumes none and only
 * checks the output-token ceiling — for stage 2, retries, and fallback grading,
 * none of which are new sessions.
 */
export type UsageKind = 'session' | 'lookup' | 'ceiling';

/**
 * Atomically checks today's caps and increments the counter for `kind`.
 * Returns false when blocked. Throws on a database error — a circuit breaker
 * that fails open on a DB hiccup would defeat its own purpose. Not wrapped in
 * withRetry: a retry after a lost response would double-count.
 */
export async function reserveUsage(
	supabase: SupabaseClient,
	userId: number,
	kind: UsageKind
): Promise<boolean> {
	const { data, error } = await supabase.rpc('reserve_target_practice_usage', {
		p_user_id: userId,
		p_kind: kind,
		p_session_cap: USAGE_LIMITS.sessionsPerDay,
		p_lookup_cap: USAGE_LIMITS.lookupsPerDay,
		p_output_ceiling: USAGE_LIMITS.outputTokensPerDay
	});
	if (error) throw error;
	return data === true;
}

/** Adds a finished call's token usage to today's row. */
export async function recordTokens(
	supabase: SupabaseClient,
	userId: number,
	tokens: { input: number; output: number }
): Promise<void> {
	const { error } = await supabase.rpc('record_target_practice_tokens', {
		p_user_id: userId,
		p_input_tokens: tokens.input,
		p_output_tokens: tokens.output
	});
	if (error) throw error;
}

/** When the UTC-day counters next reset — shown in the "cap reached" message. */
export function nextUtcMidnight(now: Date = new Date()): Date {
	return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
}
