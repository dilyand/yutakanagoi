import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireAppSecret } from '$lib/server/require-app-secret';
import { createServiceClient } from '$lib/server/supabase';
import { fetchDrillContext, startSession } from '$lib/server/drill-repository';
import { verifyListOwnership, ListNotFoundError } from '$lib/server/user-list-repository';
import { selectDrillWords } from '$lib/drill-algorithm';
import { checkRateLimit } from '$lib/server/rate-limit';

const RequestSchema = z.object({ listId: z.number().int(), userId: z.number().int() });

// Starting a session a few times in a row (start, cancel, restart) is normal
// use; 20/5min per IP just bounds a runaway client-side retry loop from
// inflating session_index, which the due-word interval math in
// drill-algorithm.ts depends on.
const LIMIT = 20;
const WINDOW_MS = 5 * 60 * 1000;

// Starting a session is a deliberate action (not tied to page load) so that
// refreshing the drill page never accidentally increments session_index.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	requireAppSecret(request);
	if (!checkRateLimit(`session-start:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) {
		error(400, 'Invalid request body');
	}
	const { listId, userId } = parsedBody.data;

	const supabase = createServiceClient();
	try {
		await verifyListOwnership(supabase, listId, userId);
	} catch (e) {
		if (e instanceof ListNotFoundError) error(403, e.message);
		throw e;
	}

	const context = await fetchDrillContext(supabase, listId);
	const sessionIndex = await startSession(supabase, listId);
	const drillItems = selectDrillWords(context.vocabMaster, context.wordStates, sessionIndex);

	return json({ sessionIndex, drillItems });
};
