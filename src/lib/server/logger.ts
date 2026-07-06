import { createServiceClient } from '$lib/server/supabase';

/**
 * Logs an unexpected server-side error: always to console.error as a
 * structured JSON line (Vercel captures stdout/stderr on every plan, so this
 * needs no setup), and best-effort into the error_events table (persists
 * past Vercel's short log retention, and is queryable via `npm run
 * logs:errors` — see supabase/README.md). A failure to write error_events is
 * itself only console.error'd, never thrown, so logging can't cause the
 * error it's trying to report.
 */
export async function logError(
	route: string,
	err: unknown,
	context: Record<string, unknown> = {}
): Promise<void> {
	const message = err instanceof Error ? err.message : String(err);
	const stack = err instanceof Error ? err.stack : undefined;
	const occurredAt = new Date().toISOString();

	console.error(JSON.stringify({ level: 'error', occurredAt, route, message, context }));

	try {
		const supabase = createServiceClient();
		const { error } = await supabase
			.from('error_events')
			.insert({ occurred_at: occurredAt, route, message, stack, context });
		if (error) throw error;
	} catch (loggingError) {
		console.error('Failed to persist error_events row:', loggingError);
	}
}
