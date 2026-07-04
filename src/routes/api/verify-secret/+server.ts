import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAppSecret } from '$lib/server/require-app-secret';

// Cheap endpoint for the passphrase gate to check a candidate secret against
// APP_SHARED_SECRET without touching Claude or Supabase — lets the entry
// screen give immediate feedback instead of failing on the first real action.
export const POST: RequestHandler = async ({ request }) => {
	requireAppSecret(request);
	return json({ ok: true });
};
