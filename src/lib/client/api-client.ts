import { getStoredAppSecret } from './app-secret';

export async function authorizedGet<T>(path: string): Promise<T> {
	const secret = getStoredAppSecret();
	const response = await fetch(path, {
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
	const response = await fetch(path, {
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
