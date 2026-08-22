import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createServiceClient } from '$lib/server/supabase';
import { flagChunk } from '$lib/server/shadowing-repository';
import { verifyUserExists, UserNotFoundError } from '$lib/server/conjugation-auth';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireUserId } from '$lib/server/require-session';

// Flagging is a rare, deliberate action (at most a couple per session), so
// a tighter bucket than the per-session-start/complete limits is enough
// headroom while still bounding abuse.
const LIMIT = 10;
const WINDOW_MS = 5 * 60 * 1000;

const RequestSchema = z.object({
	chunkId: z.string().max(200),
	note: z.string().max(500).optional()
});

// Scoped by the session-derived userId in flagChunk's own query — a chunk
// belonging to a different user is simply not matched and not modified,
// rather than erroring, since a client-supplied chunkId for another user's
// (private) chunk should behave the same as a chunkId that doesn't exist.
export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	const userId = requireUserId(locals);
	if (!checkRateLimit(`shadowing-chunks-flag:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) {
		error(400, 'Invalid request body');
	}
	const { chunkId, note } = parsedBody.data;

	const supabase = createServiceClient();
	try {
		await verifyUserExists(supabase, userId);
	} catch (e) {
		if (e instanceof UserNotFoundError) error(403, e.message);
		throw e;
	}

	await flagChunk(supabase, userId, chunkId, note);

	return json({ ok: true });
};
