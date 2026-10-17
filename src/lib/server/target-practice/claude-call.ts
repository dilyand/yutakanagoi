import type Anthropic from '@anthropic-ai/sdk';
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { createClient } from '$lib/server/claude-shared';
import { logError } from '$lib/server/logger';
import { nextUtcMidnight, recordTokens, reserveUsage, type UsageKind } from './usage';

/**
 * Thrown before any Claude call is made when target practice is switched off
 * or today's caps are used up. Routes map this to a clear message (with the
 * reset time) or, for fallback grading, to the neutral "couldn't check" path —
 * which is why this is a plain error and not SvelteKit's `error()`.
 */
export class UsageCapError extends Error {
	constructor(
		readonly reason: 'disabled' | 'cap_reached',
		readonly kind: UsageKind,
		readonly resetsAt: Date
	) {
		super(
			reason === 'disabled'
				? 'Target practice is currently switched off.'
				: 'Daily target practice limit reached.'
		);
		this.name = 'UsageCapError';
	}
}

/** Kill switch: set TARGET_PRACTICE_ENABLED to "false" (or "0") to disable. */
export function isTargetPracticeEnabled(): boolean {
	const value = env.TARGET_PRACTICE_ENABLED?.trim().toLowerCase();
	return value !== 'false' && value !== '0';
}

type WithUsage = {
	usage: {
		input_tokens: number;
		output_tokens: number;
		cache_creation_input_tokens?: number | null;
		cache_read_input_tokens?: number | null;
	};
};

/**
 * The one door every target-practice Claude call goes through: checks the
 * kill switch, reserves usage atomically *before* the call (counters
 * increment at call start so two tabs can't race, and nothing is refunded on
 * failure — a refund would weaken the breaker in exactly the runaway case),
 * then records the response's token usage afterward.
 *
 * `call` receives a client and returns the SDK response (it must expose
 * `.usage`, which every Messages response does); the response is returned
 * untouched. Parallel calls can overshoot the token ceiling slightly, since
 * tokens are only known afterward — acceptable for a breaker. A call that
 * throws (SDK error, invalid structured output) records nothing: the
 * response, and its usage, never reached us.
 *
 * Pass `timeoutMs` above the 20s default for long generation calls.
 */
export async function callClaude<T extends WithUsage>(opts: {
	supabase: SupabaseClient;
	userId: number;
	kind: UsageKind;
	timeoutMs?: number;
	call: (client: Anthropic) => Promise<T>;
}): Promise<T> {
	const { supabase, userId, kind, timeoutMs, call } = opts;

	if (!isTargetPracticeEnabled()) {
		throw new UsageCapError('disabled', kind, nextUtcMidnight());
	}
	if (!(await reserveUsage(supabase, userId, kind))) {
		throw new UsageCapError('cap_reached', kind, nextUtcMidnight());
	}

	const response = await call(createClient({ timeoutMs }));

	const { usage } = response;
	try {
		await recordTokens(supabase, userId, {
			input:
				usage.input_tokens +
				(usage.cache_creation_input_tokens ?? 0) +
				(usage.cache_read_input_tokens ?? 0),
			output: usage.output_tokens
		});
	} catch (e) {
		// The user's call already succeeded — losing the tally must not turn it
		// into a failure. Log so a persistent recording fault is visible.
		await logError('target-practice/claude-call', e, { userId, kind });
	}
	return response;
}
