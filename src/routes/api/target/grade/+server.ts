import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createServiceClient } from '$lib/server/supabase';
import { verifyUserExists, UserNotFoundError } from '$lib/server/conjugation-auth';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireUserId } from '$lib/server/require-session';
import { gradeAnswers } from '$lib/server/target-practice/grade';
import { parseRequestCard } from '$lib/server/target-practice/request-card';
import { MAX_GRADE_ITEMS } from '$lib/target-practice/grade';
import { TARGET_TYPES } from '$lib/target-practice/types';

// A session's worst case is a handful of typed fallbacks plus the Use phase;
// the daily token ceiling is the real backstop (see usage.ts).
const LIMIT = 45;
const WINDOW_MS = 5 * 60 * 1000;

// Everything here round-trips through the client, so it is bounded; the card is
// re-validated by parseRequestCard.
const text = () => z.string().max(300);
const answers = () => z.array(z.string().max(200)).max(12);

const GradeInputSchema = z.discriminatedUnion('mode', [
	z.object({
		mode: z.literal('typed'),
		instruction: text(),
		sentence: text(),
		cue: text(),
		answer: z.string().max(200),
		accepted: answers(),
		learnerAnswer: text()
	}),
	z.object({
		mode: z.literal('use'),
		instruction: text(),
		sentence: text(),
		expected: answers(),
		free: z.boolean(),
		learnerAnswer: text()
	})
]);

const RequestSchema = z.object({
	type: z.enum(TARGET_TYPES),
	card: z.record(z.string(), z.unknown()),
	items: z.array(GradeInputSchema).min(1).max(MAX_GRADE_ITEMS)
});

export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	const userId = requireUserId(locals);
	if (!checkRateLimit(`target-grade:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) error(400, 'Invalid request body');
	const { type, card: rawCard, items } = parsedBody.data;
	const card = parseRequestCard(type, rawCard);

	const supabase = createServiceClient();
	try {
		await verifyUserExists(supabase, userId);
	} catch (e) {
		if (e instanceof UserNotFoundError) error(403, e.message);
		throw e;
	}

	return json(await gradeAnswers(supabase, userId, card, items));
};
