import { getStoredAppSecret } from './app-secret';

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

// Users only ever see the friendly message below — the raw response (which
// can contain a Postgres/stack-ish string) is only ever console.error'd, for
// debugging, mirroring the friendly-message-plus-logged-detail pattern
// hooks.server.ts's handleError already uses server-side.
async function throwFriendlyError(path: string, response: Response): Promise<never> {
	const detail = await response.text();
	console.error(`${path} failed: ${response.status} ${detail}`);

	const message =
		response.status === 401
			? 'Session expired — please unlock again.'
			: response.status === 403
				? "You don't have access to this list."
				: response.status === 429
					? 'Too many requests — please wait a moment and try again.'
					: 'Something went wrong. Please try again.';
	throw new Error(message);
}

export async function authorizedGet<T>(path: string): Promise<T> {
	const secret = getStoredAppSecret();
	const response = await fetchWithRetry(path, {
		headers: {
			...(secret ? { Authorization: `Bearer ${secret}` } : {})
		}
	});
	if (!response.ok) {
		await throwFriendlyError(path, response);
	}
	return response.json();
}

export async function authorizedPost<T>(path: string, body: unknown): Promise<T> {
	const secret = getStoredAppSecret();
	const response = await fetchWithRetry(path, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			...(secret ? { Authorization: `Bearer ${secret}` } : {})
		},
		body: JSON.stringify(body)
	});
	if (!response.ok) {
		await throwFriendlyError(path, response);
	}
	return response.json();
}
