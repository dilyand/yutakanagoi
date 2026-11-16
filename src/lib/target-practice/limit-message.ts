import type { LimitOutcome } from './lookup';

/**
 * The learner-facing text for a `limit` outcome. The server words the reset as
 * UTC (it cannot know the learner's zone); the UI swaps in the local time
 * (design doc §11).
 */
export function formatLimitMessage(
	outcome: LimitOutcome,
	locale?: string,
	timeZone?: string
): string {
	if (outcome.reason === 'disabled') return outcome.message;
	const resets = new Date(outcome.resetsAt);
	if (Number.isNaN(resets.getTime())) return outcome.message;
	const when = resets.toLocaleString(locale, {
		weekday: 'short',
		hour: '2-digit',
		minute: '2-digit',
		timeZone
	});
	return outcome.message.replace(/ — it resets at .*$/, ` — it resets ${when}.`);
}
