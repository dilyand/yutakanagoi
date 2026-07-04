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

const RequestSchema = z.object({
	listId: z.number().int(),
	sessionIndex: z.number().int(),
	wordStates: z.array(
		z.object({
			word: z.string(),
			box: z.number().int().min(0).max(4),
			lastSession: z.number().int()
		})
	),
	attempts: z.array(
		z.object({
			word: z.string(),
			wasNewWord: z.boolean(),
			correct: z.boolean(),
			boxBefore: z.number().int().min(0).max(4),
			boxAfter: z.number().int().min(0).max(4),
			userAnswer: z.string().optional()
		})
	)
});

// Persists the whole session's outcome in one call once every word has been
// drilled, rather than writing after each word — one round trip, and a
// mid-session network failure never leaves partially-written state.
export const POST: RequestHandler = async ({ request }) => {
	requireAppSecret(request);

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) {
		error(400, 'Invalid request body');
	}
	const { listId, sessionIndex, wordStates, attempts } = parsedBody.data;

	const supabase = createServiceClient();
	await upsertWordStates(supabase, listId, wordStates);
	await insertSessionAttempts(supabase, listId, sessionIndex, attempts);
	await completeSession(supabase, listId, sessionIndex, wordStates.length);

	return json({ ok: true });
};
