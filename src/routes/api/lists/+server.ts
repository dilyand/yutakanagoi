import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServiceClient } from '$lib/server/supabase';
import { listWordListsForUser } from '$lib/server/user-list-repository';
import { requireUserId } from '$lib/server/require-session';

// Lists are private per user — this only ever returns the logged-in user's own lists.
export const GET: RequestHandler = async ({ locals }) => {
	const userId = requireUserId(locals);

	const supabase = createServiceClient();
	const lists = await listWordListsForUser(supabase, userId);

	return json({ lists });
};
