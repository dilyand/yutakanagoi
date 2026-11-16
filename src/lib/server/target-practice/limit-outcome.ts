import type { LimitOutcome } from '$lib/target-practice/lookup';
import type { UsageCapError } from './claude-call';

const WHAT: Record<UsageCapError['kind'], string> = {
	lookup: 'lookup',
	session: 'practice session',
	ceiling: 'usage'
};

/**
 * A usage-cap or kill-switch hit as a normal HTTP 200 outcome (design doc §11:
 * `apiPost` drops 429 bodies, so a 429 could never show "resets at …"). Shared
 * by the lookup and generation routes.
 */
export function limitOutcome(e: UsageCapError): LimitOutcome {
	const resetsAt = e.resetsAt.toISOString();
	return {
		status: 'limit',
		reason: e.reason,
		resetsAt,
		message:
			e.reason === 'disabled'
				? 'Target practice is switched off right now.'
				: `Daily ${WHAT[e.kind]} limit reached — it resets at ${resetsAt.slice(11, 16)} UTC.`
	};
}
