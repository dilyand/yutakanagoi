import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServiceClient } from '$lib/server/supabase';
import { verifyUserExists, UserNotFoundError } from '$lib/server/conjugation-auth';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireUserId } from '$lib/server/require-session';
import { listRecentTargets } from '$lib/server/target-practice/history-repository';

// A cheap DB read shown on every visit to the activity, so a looser bucket than
// the Claude-backed routes.
const LIMIT = 60;
const WINDOW_MS = 5 * 60 * 1000;

export const GET: RequestHandler = async ({ getClientAddress, locals }) => {
	const userId = requireUserId(locals);
	if (!checkRateLimit(`target-history:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const supabase = createServiceClient();
	try {
		await verifyUserExists(supabase, userId);
	} catch (e) {
		if (e instanceof UserNotFoundError) error(403, e.message);
		throw e;
	}

	return json({ recents: await listRecentTargets(supabase, userId) });
};
