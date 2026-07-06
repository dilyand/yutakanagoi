interface Window {
	count: number;
	resetAt: number;
}

// Per-instance only: this Map lives in one serverless function instance's
// memory, so it resets on cold start and isn't shared across concurrent
// instances/regions. That means the real limit under distributed abuse is
// looser than `limit` suggests — this is a soft "raise the bar" mitigation
// against casual abuse, not a hard guarantee. A correct global limit would
// need an external store (e.g. Upstash Redis), deliberately out of scope for
// this pass.
const windows = new Map<string, Window>();

/**
 * Fixed-window rate limiter. Returns true if `key` is still within `limit`
 * requests per `windowMs`, false once it's exceeded (caller should respond
 * 429). Each call counts as one request.
 */
export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
	const now = Date.now();
	const existing = windows.get(key);

	if (!existing || existing.resetAt <= now) {
		windows.set(key, { count: 1, resetAt: now + windowMs });
		return true;
	}

	if (existing.count >= limit) {
		return false;
	}

	existing.count += 1;
	return true;
}
