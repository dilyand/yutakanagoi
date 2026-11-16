import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createServiceClient } from '$lib/server/supabase';
import { verifyUserExists, UserNotFoundError } from '$lib/server/conjugation-auth';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireUserId } from '$lib/server/require-session';
import { deleteRecentTarget } from '$lib/server/target-practice/history-repository';
import { TARGET_TYPES } from '$lib/target-practice/types';

const LIMIT = 30;
const WINDOW_MS = 5 * 60 * 1000;

const RequestSchema = z.object({
	type: z.enum(TARGET_TYPES),
	targetKey: z.string().min(1).max(200)
});

// Scoped by the session-derived userId in deleteRecentTarget's own query: a key
// that belongs to someone else, or to nobody, simply matches nothing.
export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	const userId = requireUserId(locals);
	if (!checkRateLimit(`target-history-delete:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) error(400, 'Invalid request body');
	const { type, targetKey } = parsedBody.data;

	const supabase = createServiceClient();
	try {
		await verifyUserExists(supabase, userId);
	} catch (e) {
		if (e instanceof UserNotFoundError) error(403, e.message);
		throw e;
	}

	await deleteRecentTarget(supabase, userId, type, targetKey);
	return json({ ok: true });
};
