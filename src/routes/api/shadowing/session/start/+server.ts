import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServiceClient } from '$lib/server/supabase';
import {
	fetchChunkLibrary,
	fetchShadowingContext,
	fetchChunkDetailsWithSignedUrls,
	insertSessionRow,
	getLatestSessionIndex
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

	// Deliberately not persisted yet — see insertSessionRow's doc comment.
	// The first attempt's value is the same one startSession used to
	// compute (read then insert); context.sessionIndex already came from
	// that same read via fetchShadowingContext above, so no second query is
	// needed yet. A later attempt (see the retry loop below) re-reads it.
	let sessionIndex = context.sessionIndex + 1;

	// Two concurrent session/start calls for the same user can both land
	// here with the same sessionIndex (both read the same latest value
	// above/on a prior retry) — only one insertSessionRow can win the
	// unique (user_id, session_index) constraint. Rather than surface that
	// as a raw 500 after already doing the signing work below, retry with a
	// freshly re-read session_index on that specific conflict. Bounded: a
	// real, repeated conflict past a few attempts means something other
	// than an ordinary race is going on, and should surface as an error
	// rather than retry forever.
	const MAX_SESSION_START_ATTEMPTS = 3;
	let items: {
		chunkId: string;
		isNew: boolean;
		box: number | undefined;
		box4Streak: number | undefined;
		audioUrl: string;
		transcript: string;
		kana: string;
		translation: string;
		durationMs: number;
	}[] = [];
	for (let attempt = 1; attempt <= MAX_SESSION_START_ATTEMPTS; attempt++) {
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

		items = drillItems.map((item) => {
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
		// nothing above has thrown — see insertSessionRow's doc comment.
		try {
			await insertSessionRow(supabase, userId, sessionIndex);
			break;
		} catch (e) {
			const isSessionIndexConflict =
				typeof e === 'object' && e !== null && 'code' in e && e.code === '23505';
			if (!isSessionIndexConflict || attempt === MAX_SESSION_START_ATTEMPTS) throw e;
			sessionIndex = (await getLatestSessionIndex(supabase, userId)) + 1;
		}
	}

	return json({ sessionIndex, drillItems: items });
};
