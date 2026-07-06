import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireAppSecret } from '$lib/server/require-app-secret';
import { createServiceClient } from '$lib/server/supabase';
import {
	upsertWordStates,
	insertSessionAttempts,
	completeSession
} from '$lib/server/drill-repository';
import { verifyListOwnership, ListNotFoundError } from '$lib/server/user-list-repository';
import { checkRateLimit } from '$lib/server/rate-limit';

// Paired with session/start's limit — completing a session a few times in a
// row (e.g. cancelling early) is normal use; 20/5min per IP just bounds a
// runaway client-side retry loop.
const LIMIT = 20;
const WINDOW_MS = 5 * 60 * 1000;

// A session is at most 10 words (see drill-algorithm.ts), so 50 leaves
// generous headroom while still bounding the payload size.
const RequestSchema = z.object({
	listId: z.number().int(),
	userId: z.number().int(),
	sessionIndex: z.number().int(),
	wordStates: z
		.array(
			z.object({
				word: z.string(),
				box: z.number().int().min(0).max(4),
				lastSession: z.number().int()
			})
		)
		.max(50),
	attempts: z
		.array(
			z.object({
				word: z.string(),
				wasNewWord: z.boolean(),
				correct: z.boolean(),
				boxBefore: z.number().int().min(0).max(4),
				boxAfter: z.number().int().min(0).max(4),
				userAnswer: z.string().max(500).optional()
			})
		)
		.max(50)
});

// Persists the whole session's outcome in one call once every word has been
// drilled, rather than writing after each word — one round trip, and a
// mid-session network failure never leaves partially-written state.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	requireAppSecret(request);
	if (!checkRateLimit(`session-complete:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) {
		error(400, 'Invalid request body');
	}
	const { listId, userId, sessionIndex, wordStates, attempts } = parsedBody.data;

	const supabase = createServiceClient();
	try {
		await verifyListOwnership(supabase, listId, userId);
	} catch (e) {
		if (e instanceof ListNotFoundError) error(403, e.message);
		throw e;
	}

	await upsertWordStates(supabase, listId, wordStates);
	await insertSessionAttempts(supabase, listId, sessionIndex, attempts);
	await completeSession(supabase, listId, sessionIndex, wordStates.length);

	return json({ ok: true });
};
