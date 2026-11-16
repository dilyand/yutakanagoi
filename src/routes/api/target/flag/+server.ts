import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createServiceClient } from '$lib/server/supabase';
import { verifyUserExists, UserNotFoundError } from '$lib/server/conjugation-auth';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireUserId } from '$lib/server/require-session';
import { insertFlag } from '$lib/server/target-practice/flags-repository';
import { MAX_FLAG_ITEM_JSON, MAX_FLAG_NOTE, isFlagReason } from '$lib/target-practice/flags';
import { PHASE_IDS, TARGET_TYPES } from '$lib/target-practice/types';

// Flagging is a rare, deliberate action; the flags are read to tune prompts.
const LIMIT = 20;
const WINDOW_MS = 5 * 60 * 1000;

const RequestSchema = z.object({
	type: z.enum(TARGET_TYPES),
	targetKey: z.string().min(1).max(200),
	phase: z.enum(PHASE_IDS).optional(),
	// The item as the learner saw it; null/absent for a flag on the card itself.
	item: z.unknown().optional(),
	reason: z.string().refine(isFlagReason, 'Unknown reason'),
	note: z.string().max(MAX_FLAG_NOTE).optional()
});

export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	const userId = requireUserId(locals);
	if (!checkRateLimit(`target-flag:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) error(400, 'Invalid request body');
	const flag = parsedBody.data;
	if (flag.item !== undefined && JSON.stringify(flag.item).length > MAX_FLAG_ITEM_JSON) {
		error(400, 'The item is too large.');
	}

	const supabase = createServiceClient();
	try {
		await verifyUserExists(supabase, userId);
	} catch (e) {
		if (e instanceof UserNotFoundError) error(403, e.message);
		throw e;
	}

	await insertFlag(supabase, userId, flag);
	return json({ ok: true });
};
