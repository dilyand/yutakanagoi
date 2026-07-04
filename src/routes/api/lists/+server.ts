import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAppSecret } from '$lib/server/require-app-secret';
import { createServiceClient } from '$lib/server/supabase';
import { listWordListsForUser } from '$lib/server/user-list-repository';

// Lists are private per user — this only ever returns the requested user's own lists.
export const GET: RequestHandler = async ({ request, url }) => {
	requireAppSecret(request);

	const userIdParam = url.searchParams.get('userId');
	const userId = userIdParam ? Number(userIdParam) : NaN;
	if (!Number.isInteger(userId)) {
		error(400, 'userId query parameter is required');
	}

	const supabase = createServiceClient();
	const lists = await listWordListsForUser(supabase, userId);

	return json({ lists });
};
