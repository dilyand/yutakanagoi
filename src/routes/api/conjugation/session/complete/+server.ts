import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createServiceClient } from '$lib/server/supabase';
import {
	upsertCellStates,
	insertSessionAttempts,
	completeSession
} from '$lib/server/conjugation-repository';
import { verifyUserExists, UserNotFoundError } from '$lib/server/conjugation-auth';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireUserId } from '$lib/server/require-session';

// Paired with conjugation session/start's limit — separate bucket from
// vocab's, same 20/5min shape.
const LIMIT = 20;
const WINDOW_MS = 5 * 60 * 1000;

// A session is at most 10 cells (see drill-algorithm.ts, reused as-is), so
// 50 leaves generous headroom while still bounding the payload size.
const RequestSchema = z.object({
	sessionIndex: z.number().int(),
	cellStates: z
		.array(
			z.object({
				cellId: z.string(),
				box: z.number().int().min(0).max(4),
				lastSession: z.number().int(),
				box4Streak: z.number().int().min(0)
			})
		)
		.max(50),
	attempts: z
		.array(
			z.object({
				cellId: z.string(),
				word: z.string().max(100),
				wasNewCell: z.boolean(),
				correct: z.boolean(),
				boxBefore: z.number().int().min(0).max(4),
				boxAfter: z.number().int().min(0).max(4),
				userAnswer: z.string().max(500).optional(),
				attemptsUsed: z.number().int().min(1).max(3)
			})
		)
		.max(50)
});

// Persists the whole session's outcome in one call once every cell has been
// drilled, same rationale as vocab's session/complete.
export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	const userId = requireUserId(locals);
	if (!checkRateLimit(`conjugation-session-complete:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) {
		error(400, 'Invalid request body');
	}
	const { sessionIndex, cellStates, attempts } = parsedBody.data;

	const supabase = createServiceClient();
	try {
		await verifyUserExists(supabase, userId);
	} catch (e) {
		if (e instanceof UserNotFoundError) error(403, e.message);
		throw e;
	}

	await upsertCellStates(
		supabase,
		userId,
		cellStates.map((c) => ({
			word: c.cellId,
			box: c.box,
			lastSession: c.lastSession,
			box4Streak: c.box4Streak
		}))
	);
	await insertSessionAttempts(supabase, userId, sessionIndex, attempts);
	await completeSession(supabase, userId, sessionIndex, cellStates.length);

	return json({ ok: true });
};
