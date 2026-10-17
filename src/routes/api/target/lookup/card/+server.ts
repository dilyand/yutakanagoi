import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createServiceClient } from '$lib/server/supabase';
import { verifyUserExists, UserNotFoundError } from '$lib/server/conjugation-auth';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireUserId } from '$lib/server/require-session';
import { lookupCard } from '$lib/server/target-practice/lookup';
import { TARGET_TYPES } from '$lib/target-practice/types';
import { confirmTarget } from '$lib/target-practice/lookup';

// Generous headroom for a card call (~10s typical, 25s client timeout). Fluid
// compute already defaults to 300s; this keeps the bound explicit, and valid on
// every plan, if that ever changes.
export const config = { maxDuration: 60 };

const LIMIT = 20;
const WINDOW_MS = 5 * 60 * 1000;

// reading/gloss come from the candidate step via the client, so they are
// untrusted: bounded here, then re-checked in confirmTarget.
const RequestSchema = z.object({
	type: z.enum(TARGET_TYPES),
	target: z.string().max(200),
	reading: z.string().max(100).optional(),
	gloss: z.string().max(200).optional()
});

export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	const userId = requireUserId(locals);
	if (!checkRateLimit(`target-lookup-card:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) error(400, 'Invalid request body');
	const { type, ...input } = parsedBody.data;

	const confirmed = confirmTarget(type, input);
	if (!confirmed.ok) error(400, confirmed.message);

	const supabase = createServiceClient();
	try {
		await verifyUserExists(supabase, userId);
	} catch (e) {
		if (e instanceof UserNotFoundError) error(403, e.message);
		throw e;
	}

	return json(await lookupCard(supabase, userId, confirmed.confirmed));
};
