// Postgrest errors carry a `.code` (e.g. '23505' for a unique violation) —
// those are deterministic outcomes of the data/request, not worth retrying.
// Anything without one is treated as transient (network blip, timeout) and
// gets retried; this also matches the shape of a plain thrown Error/TypeError
// from a fetch failure, which never has a `.code`.
function isTransientError(err: unknown): boolean {
	return typeof err === 'object' && err !== null && !('code' in err);
}

/**
 * Retries `fn` on transient-looking errors (see isTransientError), with a
 * short fixed backoff between attempts. Real errors (Postgrest error codes
 * like unique-violations) are rethrown immediately on first failure.
 */
export async function withRetry<T>(
	// PromiseLike, not Promise: Supabase's query builders are thenable but
	// aren't real Promise instances (no .catch/.finally), so a plain
	// `Promise<T>` parameter type rejects them structurally.
	fn: () => PromiseLike<T>,
	{ retries = 2, delayMs = 200 }: { retries?: number; delayMs?: number } = {}
): Promise<T> {
	let lastError: unknown;
	for (let attempt = 0; attempt <= retries; attempt++) {
		try {
			return await fn();
		} catch (err) {
			lastError = err;
			if (!isTransientError(err) || attempt === retries) {
				throw err;
			}
			await new Promise((resolve) => setTimeout(resolve, delayMs));
		}
	}
	throw lastError;
}
