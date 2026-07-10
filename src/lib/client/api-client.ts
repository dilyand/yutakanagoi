// Only retries when fetch() itself throws (offline, DNS failure, connection
// dropped before any response) — never on a real HTTP response, even a 5xx.
// A 5xx means the server received and processed the request, and several
// endpoints (session/start, session/complete) aren't safe to blindly replay
// (they'd increment session_index or insert duplicate attempt rows again) —
// so retrying there is only safe when we're confident the server never saw
// the request at all.
async function fetchWithRetry(path: string, init: RequestInit): Promise<Response> {
	try {
		return await fetch(path, init);
	} catch (e) {
		await new Promise((resolve) => setTimeout(resolve, 300));
		try {
			return await fetch(path, init);
		} catch {
			throw e;
		}
	}
}

// Carries the HTTP status alongside the friendly message so callers that
// need to branch on a specific status (e.g. a 409 name conflict offering an
// "update instead?" flow) can, while every existing `instanceof Error`
// call site keeps working unchanged.
export class HttpError extends Error {
	constructor(
		message: string,
		public readonly status: number
	) {
		super(message);
		this.name = 'HttpError';
	}
}

// Users only ever see the friendly message below — the raw response (which
// can contain a Postgres/stack-ish string) is only ever console.error'd, for
// debugging, mirroring the friendly-message-plus-logged-detail pattern
// hooks.server.ts's handleError already uses server-side.
async function throwFriendlyError(path: string, response: Response): Promise<never> {
	const detail = await response.text();
	console.error(`${path} failed: ${response.status} ${detail}`);

	const message =
		response.status === 401
			? 'Please sign in again.'
			: response.status === 403
				? "You don't have access to this list."
				: response.status === 429
					? 'Too many requests — please wait a moment and try again.'
					: 'Something went wrong. Please try again.';
	throw new HttpError(message, response.status);
}

// Same-origin fetch sends the httpOnly session cookie automatically — no
// Authorization header to attach here (see src/hooks.server.ts).
export async function apiGet<T>(path: string): Promise<T> {
	const response = await fetchWithRetry(path, {});
	if (!response.ok) {
		await throwFriendlyError(path, response);
	}
	return response.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
	const response = await fetchWithRetry(path, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	});
	if (!response.ok) {
		await throwFriendlyError(path, response);
	}
	return response.json();
}
