import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createServiceClient } from '$lib/server/supabase';
import { fetchChunkDetailsWithSignedUrls } from '$lib/server/shadowing-repository';
import { verifyUserExists, UserNotFoundError } from '$lib/server/conjugation-auth';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireUserId } from '$lib/server/require-session';

// Radio asks for one or two clips each time it advances (the one about to
// play, then the next to prefetch), so the steady-state rate is one request
// per clip — a clip is seconds long at the very least, and a few minutes
// per clip at the default 3 repeats of a 40-90s recording. This leaves room
// for short clips, retries and a second tab without being unbounded. Its own
// bucket, separate from the drill's.
const LIMIT = 120;
const WINDOW_MS = 5 * 60 * 1000;

// Capped small on purpose: radio only ever needs "current" and "next", and
// every id costs a Storage signing call.
const MAX_CHUNK_IDS = 5;

const RequestSchema = z.object({
	chunkIds: z.array(z.string().max(200)).min(1).max(MAX_CHUNK_IDS)
});

/**
 * Mints fresh signed audio URLs for the given chunk ids, on demand. Radio's
 * playlist (see /api/shadowing/radio/playlist) is ids only, because one
 * pass over a library can outlast a signed URL's TTL — fetching URLs
 * just-in-time means a listening run of any length keeps working.
 *
 * Read-only. Scoped by the session-derived userId in the repository query,
 * and limited to verified, unflagged chunks there too: an id belonging to
 * another user, a flagged chunk, or one that doesn't exist is simply absent
 * from the response (never an error), so it's indistinguishable from any
 * other missing id.
 */
export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	const userId = requireUserId(locals);
	if (!checkRateLimit(`shadowing-radio-clips:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		error(400, 'Invalid request body');
	}
	const parsedBody = RequestSchema.safeParse(body);
	if (!parsedBody.success) {
		error(400, 'Invalid request body');
	}

	const supabase = createServiceClient();
	try {
		await verifyUserExists(supabase, userId);
	} catch (e) {
		if (e instanceof UserNotFoundError) error(403, e.message);
		throw e;
	}

	// Deduped (order kept) so a repeated id can't come back as repeated clips.
	const chunkIds = [...new Set(parsedBody.data.chunkIds)];
	const clips = await fetchChunkDetailsWithSignedUrls(supabase, userId, chunkIds);

	return json({ clips });
};
