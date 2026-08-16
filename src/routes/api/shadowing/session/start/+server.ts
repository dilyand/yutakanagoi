import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServiceClient } from '$lib/server/supabase';
import {
	fetchChunkLibrary,
	fetchShadowingContext,
	fetchChunkDetailsWithSignedUrls,
	startSession
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
	// library is a per-user DB fetch (see fetchChunkLibrary), so it's
	// fetched alongside context rather than being static code.
	const [library, context] = await Promise.all([
		fetchChunkLibrary(supabase, userId),
		fetchShadowingContext(supabase, userId)
	]);

	// selectDrillWords's due-review and not-yet-due-fallback paths (see
	// drill-algorithm.ts's pickDueWordsRoundRobin/pickEarliestNotYetDue)
	// pull straight from the progress list (chunkStates here), with no
	// cross-check against the master list — correct for vocab/conjugation,
	// where a tracked word never leaves the master list it came from, but
	// NOT correct for shadowing: flagging a chunk removes it from
	// fetchChunkLibrary's result without touching its shadowing_state row,
	// so an unfiltered chunkStates would let a flagged chunk's old
	// progress resurface through those fallback paths even though it's no
	// longer in `library`. Filtering here, rather than teaching
	// selectDrillWords about "master list" membership, keeps that shared,
	// vocab/conjugation-tested function untouched.
	const libraryChunkIds = new Set(library.map((entry) => entry.chunkId));
	const eligibleChunkStates = context.chunkStates.filter((state) =>
		libraryChunkIds.has(state.word)
	);

	const sessionIndex = await startSession(supabase, userId);

	const drillItems = selectDrillWords(
		library.map((entry) => ({ word: entry.chunkId, frequencyRank: entry.frequencyRank })),
		eligibleChunkStates,
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

	return json({ sessionIndex, drillItems: items });
};
