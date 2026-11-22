import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServiceClient } from '$lib/server/supabase';
import {
	fetchChunkLibrary,
	fetchShadowingChunkStates,
	getLatestSessionIndex
} from '$lib/server/shadowing-repository';
import { verifyUserExists, UserNotFoundError } from '$lib/server/conjugation-auth';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireUserId } from '$lib/server/require-session';
import { orderRadioPlaylist } from '$lib/shadowing/radio-playlist';

// Radio re-fetches this once per full pass over the library (tens of
// minutes at least), so 20/5min is generous headroom for retries and for
// several tabs. Its own bucket, so radio can't starve the drill's
// session/start budget (or vice versa).
const LIMIT = 20;
const WINDOW_MS = 5 * 60 * 1000;

/**
 * Read-only: returns every chunk id in this user's library in "most due
 * first" order (see orderRadioPlaylist). Deliberately never writes — radio
 * mode records no progress, so this must not insert a shadowing_sessions
 * row or touch shadowing_state (session/start's `latest + 1` index is
 * computed only to decide what counts as due, and is discarded).
 *
 * Ids only, no audio URLs: a full pass can outlast a signed URL's TTL, so
 * the client fetches URLs just-in-time via /api/shadowing/radio/clips.
 */
export const POST: RequestHandler = async ({ getClientAddress, locals }) => {
	const userId = requireUserId(locals);
	if (!checkRateLimit(`shadowing-radio-playlist:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const supabase = createServiceClient();
	try {
		await verifyUserExists(supabase, userId);
	} catch (e) {
		if (e instanceof UserNotFoundError) error(403, e.message);
		throw e;
	}

	const [library, latestSessionIndex] = await Promise.all([
		fetchChunkLibrary(supabase, userId),
		getLatestSessionIndex(supabase, userId)
	]);

	if (library.length === 0) {
		return json({ chunkIds: [] });
	}

	// Restricted to current library membership, same as session/start — see
	// fetchShadowingChunkStates's doc comment.
	const chunkStates = await fetchShadowingChunkStates(
		supabase,
		userId,
		library.map((entry) => entry.chunkId)
	);

	return json({ chunkIds: orderRadioPlaylist(library, chunkStates, latestSessionIndex + 1) });
};
