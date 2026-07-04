import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAppSecret } from '$lib/server/require-app-secret';
import { createServiceClient } from '$lib/server/supabase';
import { listUsers } from '$lib/server/user-list-repository';

// Users are created out-of-band via scripts/add-user.ts, never through the app —
// this just lists them for the username dropdown.
export const GET: RequestHandler = async ({ request }) => {
	requireAppSecret(request);

	const supabase = createServiceClient();
	const users = await listUsers(supabase);

	return json({ users });
};
