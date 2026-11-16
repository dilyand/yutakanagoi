import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createServiceClient } from '$lib/server/supabase';
import { verifyUserExists, UserNotFoundError } from '$lib/server/conjugation-auth';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireUserId } from '$lib/server/require-session';
import { lookupCandidates } from '$lib/server/target-practice/lookup';
import { TARGET_TYPES } from '$lib/target-practice/types';
import { validateTargetInput } from '$lib/target-practice/input-validation';

// Soft per-IP burst guard only: the real circuit breaker is the persisted
// daily lookup cap and token ceiling inside callClaude (see usage.ts).
const LIMIT = 20;
const WINDOW_MS = 5 * 60 * 1000;

// Raw length is bounded here; the real 40-character limit applies after
// cleaning, in validateTargetInput.
const RequestSchema = z.object({
	type: z.enum(TARGET_TYPES),
	input: z.string().max(200)
});

// Candidates only apply to input that can't be resolved locally (English, or a
// Japanese Word — see input-validation.ts); anything else would spend a lookup
// for nothing, so it is refused rather than forwarded.
export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	const userId = requireUserId(locals);
	if (!checkRateLimit(`target-lookup-candidates:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) error(400, 'Invalid request body');
	const { type, input } = parsedBody.data;

	const check = validateTargetInput(type, input);
	if (!check.ok) error(400, check.message);
	if (!check.needsCandidates) error(400, 'This input does not need a candidate step.');

	const supabase = createServiceClient();
	try {
		await verifyUserExists(supabase, userId);
	} catch (e) {
		if (e instanceof UserNotFoundError) error(403, e.message);
		throw e;
	}

	return json(await lookupCandidates(supabase, userId, type, check.value));
};
