import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createServiceClient } from '$lib/server/supabase';
import {
	upsertChunkStates,
	insertSessionAttempts,
	completeSession,
	verifySessionOwnership,
	SessionNotFoundError
} from '$lib/server/shadowing-repository';
import { verifyUserExists, UserNotFoundError } from '$lib/server/conjugation-auth';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireUserId } from '$lib/server/require-session';

// Paired with shadowing session/start's limit — separate bucket, same
// 20/5min shape as vocab's and conjugation's.
const LIMIT = 20;
const WINDOW_MS = 5 * 60 * 1000;

// A session is at most 10 chunks (see drill-algorithm.ts, reused as-is), so
// 50 leaves generous headroom while still bounding the payload size.
const RequestSchema = z.object({
	sessionIndex: z.number().int(),
	chunkStates: z
		.array(
			z.object({
				chunkId: z.string(),
				box: z.number().int().min(0).max(4),
				lastSession: z.number().int(),
				box4Streak: z.number().int().min(0)
			})
		)
		.max(50),
	attempts: z
		.array(
			z.object({
				chunkId: z.string(),
				wasNewChunk: z.boolean(),
				hintLevel: z.number().int().min(0).max(3),
				rating: z.enum(['easy', 'good', 'hard', 'very_hard']),
				replays: z.number().int().min(0),
				boxBefore: z.number().int().min(0).max(4),
				boxAfter: z.number().int().min(0).max(4)
			})
		)
		.max(50)
});

// Persists the whole session's outcome in one call once every chunk has
// been drilled, same rationale as vocab's and conjugation's session/complete.
export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	const userId = requireUserId(locals);
	if (!checkRateLimit(`shadowing-session-complete:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) {
		error(400, 'Invalid request body');
	}
	const { sessionIndex, chunkStates, attempts } = parsedBody.data;

	const supabase = createServiceClient();
	try {
		await verifyUserExists(supabase, userId);
	} catch (e) {
		if (e instanceof UserNotFoundError) error(403, e.message);
		throw e;
	}

	// Unconditional, up front — see verifySessionOwnership's doc comment.
	// insertSessionAttempts below does an equivalent lookup, but only when
	// attempts is non-empty, so it can't be the only guard.
	try {
		await verifySessionOwnership(supabase, userId, sessionIndex);
	} catch (e) {
		if (e instanceof SessionNotFoundError) error(404, e.message);
		throw e;
	}

	await upsertChunkStates(
		supabase,
		userId,
		chunkStates.map((c) => ({
			word: c.chunkId,
			box: c.box,
			// Derived from the now-verified sessionIndex, not the client-
			// supplied c.lastSession — see verifySessionOwnership's doc
			// comment for why trusting the payload here is what let a
			// client permanently block future updates to a chunk.
			lastSession: sessionIndex,
			box4Streak: c.box4Streak
		}))
	);
	await insertSessionAttempts(supabase, userId, sessionIndex, attempts);
	await completeSession(supabase, userId, sessionIndex, chunkStates.length);

	return json({ ok: true });
};
