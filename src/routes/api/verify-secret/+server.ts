import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAppSecret } from '$lib/server/require-app-secret';
import { checkRateLimit } from '$lib/server/rate-limit';

// This is the passphrase brute-force target — 10 attempts/5 min per IP is
// generous for a real user mistyping, but bounds a scripted guessing attack.
const LIMIT = 10;
const WINDOW_MS = 5 * 60 * 1000;

// Cheap endpoint for the passphrase gate to check a candidate secret against
// APP_SHARED_SECRET without touching Claude or Supabase — lets the entry
// screen give immediate feedback instead of failing on the first real action.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	if (!checkRateLimit(`verify-secret:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many attempts — please wait and try again.');
	}
	requireAppSecret(request);
	return json({ ok: true });
};
