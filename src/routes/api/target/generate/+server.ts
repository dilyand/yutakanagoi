import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createServiceClient } from '$lib/server/supabase';
import { verifyUserExists, UserNotFoundError } from '$lib/server/conjugation-auth';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireUserId } from '$lib/server/require-session';
import { generateStage } from '$lib/server/target-practice/generate';
import { parseRequestCard } from '$lib/server/target-practice/request-card';
import { TARGET_TYPES } from '$lib/target-practice/types';

// Worst case is one full stage call (50-70s) plus one smaller regeneration (40s),
// with SDK retries off — see generate.ts, which exports the same figure
// (GENERATE_MAX_DURATION_S; the test pins them together). A literal here because
// adapter-vercel reads `config` statically. Fluid compute defaults to 300s;
// this keeps the bound explicit, and valid on every plan.
export const config = { maxDuration: 120 };

const LIMIT = 12;
const WINDOW_MS = 5 * 60 * 1000;

// The card round-trips through the client, so it is untrusted: bounded here and
// re-validated with validateCard before it goes anywhere near a prompt.
const RequestSchema = z.object({
	stage: z.union([z.literal(1), z.literal(2)]),
	type: z.enum(TARGET_TYPES),
	card: z.record(z.string(), z.unknown()),
	// The client is retrying a failed stage: spends against the token ceiling only.
	retry: z.boolean().optional(),
	// Sentences from earlier rounds ("Another round"): the new items must not repeat them.
	avoid: z.array(z.string().max(200)).max(40).optional()
});

export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	const userId = requireUserId(locals);
	if (!checkRateLimit(`target-generate:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) error(400, 'Invalid request body');
	const { stage, type, card: rawCard, retry, avoid } = parsedBody.data;

	const card = parseRequestCard(type, rawCard);

	const supabase = createServiceClient();
	try {
		await verifyUserExists(supabase, userId);
	} catch (e) {
		if (e instanceof UserNotFoundError) error(403, e.message);
		throw e;
	}

	return json(
		await generateStage(supabase, userId, {
			stage,
			card,
			retry: retry === true,
			avoid: avoid ?? []
		})
	);
};
