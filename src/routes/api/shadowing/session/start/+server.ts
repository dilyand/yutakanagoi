import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServiceClient } from '$lib/server/supabase';
import {
	fetchChunkLibrary,
	fetchShadowingChunkStates,
	getLatestSessionIndex,
	fetchChunkDetailsWithSignedUrls,
	insertSessionRow,
	SessionAlreadyStartingError
} from '$lib/server/shadowing-repository';
import { verifyUserExists, UserNotFoundError } from '$lib/server/conjugation-auth';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireUserId } from '$lib/server/require-session';
import { MIN_NEW_SLOTS_PER_SESSION, selectDrillWords } from '$lib/drill-algorithm';

// Separate bucket from vocab's and conjugation's session-start limits so
// the three activities can't starve each other's rate-limit budget. Same
// 20/5min shape for the same reason: bounds a runaway client-side retry
// loop from inflating session_index.
const LIMIT = 20;
const WINDOW_MS = 5 * 60 * 1000;

export const POST: RequestHandler = async ({ getClientAddress, locals }) => {
	const userId = requireUserId(locals);
	if (!checkRateLimit(`shadowing-session-start:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const supabase = createServiceClient();
	try {
		await verifyUserExists(supabase, userId);
	} catch (e) {
		if (e instanceof UserNotFoundError) error(403, e.message);
		throw e;
	}

	// Shadowing has no shared registry the way conjugation does — the
	// library is a per-user DB fetch (see fetchChunkLibrary). sessionIndex
	// has no dependency on it, so it's fetched in parallel; chunkStates
	// does depend on it (see fetchShadowingChunkStates's doc comment on
	// why it's restricted to current library membership — re-chunking and
	// flagging both leave orphaned state rows behind, unreachably, so an
	// unfiltered fetch would transfer unbounded history that can never be
	// used), so it's fetched only after library resolves.
	const [library, latestSessionIndex] = await Promise.all([
		fetchChunkLibrary(supabase, userId),
		getLatestSessionIndex(supabase, userId)
	]);

	if (library.length === 0) {
		// No verified, unflagged content yet for this user (normal before
		// their first ingestion, or if everything's been flagged). Starting
		// a session below would insert a shadowing_sessions row that never
		// gets a matching session/complete call — the client shows "Session
		// complete" immediately from an empty drillItems array and only
		// calls finishSession() when advancing past a real chunk — leaving
		// an orphaned incomplete session behind on every attempt.
		return json({ sessionIndex: 0, drillItems: [] });
	}

	const libraryChunkIds = library.map((entry) => entry.chunkId);
	const chunkStates = await fetchShadowingChunkStates(supabase, userId, libraryChunkIds);

	// Deliberately not persisted yet — see insertSessionRow's doc comment.
	const sessionIndex = latestSessionIndex + 1;

	const drillItems = selectDrillWords(
		library.map((entry) => ({ word: entry.chunkId, frequencyRank: entry.frequencyRank })),
		chunkStates,
		sessionIndex,
		10,
		MIN_NEW_SLOTS_PER_SESSION
	);

	const details = await fetchChunkDetailsWithSignedUrls(
		supabase,
		userId,
		drillItems.map((item) => item.word)
	);
	const detailsByChunkId = new Map(details.map((d) => [d.chunkId, d]));

	const items = drillItems.map((item) => {
		const detail = detailsByChunkId.get(item.word);
		if (!detail) {
			// Should be unreachable — selectDrillWords only ever picks chunk
			// ids that came from fetchChunkLibrary, which only lists
			// verified/unflagged chunks that still exist in shadowing_chunks.
			throw new Error(`No chunk detail found for chunk_id ${item.word}`);
		}
		return {
			chunkId: item.word,
			isNew: item.isNew,
			box: item.isNew ? undefined : item.box,
			box4Streak: item.isNew ? undefined : item.box4Streak,
			audioUrl: detail.audioUrl,
			transcript: detail.transcript,
			kana: detail.kana,
			translation: detail.translation,
			durationMs: detail.durationMs
		};
	});

	// Only persist the session row once the response is fully built and
	// nothing above has thrown — see insertSessionRow's doc comment. A
	// unique-violation here means another session/start call for this same
	// user is concurrently in flight (both read the same latest
	// session_index before either inserted) — surfaced as a clean 409
	// rather than retried with a freshly re-read index. A retry would
	// build and return a *second*, fully valid, concurrently-active
	// session from this same stale library/state snapshot; if that second
	// session completes before this one, this session's later completion
	// would unconditionally overwrite newer box/last_session data with
	// older values computed here. Refusing outright, rather than silently
	// creating that second session, is what actually prevents the
	// regression — a client-side retry after a moment is safe precisely
	// because it re-reads fresh state instead of reusing this stale one.
	try {
		await insertSessionRow(supabase, userId, sessionIndex);
	} catch (e) {
		if (e instanceof SessionAlreadyStartingError) error(409, e.message);
		throw e;
	}

	return json({ sessionIndex, drillItems: items });
};
