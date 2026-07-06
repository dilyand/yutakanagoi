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

export async function authorizedGet<T>(path: string): Promise<T> {
	const secret = getStoredAppSecret();
	const response = await fetchWithRetry(path, {
		headers: {
			...(secret ? { Authorization: `Bearer ${secret}` } : {})
		}
	});
	if (!response.ok) {
		throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
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
		throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
	}
	return response.json();
}
