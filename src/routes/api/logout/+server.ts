import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServiceClient } from '$lib/server/supabase';
import { deleteSession, SESSION_COOKIE_NAME } from '$lib/server/session';

// Scoped entirely to whatever cookie the caller holds — no id parameter, so
// there's nothing to spoof. Idempotent: a missing/already-expired cookie is
// just a no-op, not an error.
export const POST: RequestHandler = async ({ cookies }) => {
	const token = cookies.get(SESSION_COOKIE_NAME);
	if (token) {
		const supabase = createServiceClient();
		await deleteSession(supabase, token);
	}
	cookies.delete(SESSION_COOKIE_NAME, { path: '/' });

	return json({ ok: true });
};
