import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireAppSecret } from '$lib/server/require-app-secret';
import { createServiceClient } from '$lib/server/supabase';
import { fetchDrillContext, startSession } from '$lib/server/drill-repository';
import { selectDrillWords } from '$lib/drill-algorithm';

const RequestSchema = z.object({ listId: z.number().int() });

// Starting a session is a deliberate action (not tied to page load) so that
// refreshing the drill page never accidentally increments session_index.
export const POST: RequestHandler = async ({ request }) => {
	requireAppSecret(request);

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) {
		error(400, 'Invalid request body');
	}
	const { listId } = parsedBody.data;

	const supabase = createServiceClient();
	const context = await fetchDrillContext(supabase, listId);
	const sessionIndex = await startSession(supabase, listId);
	const drillItems = selectDrillWords(context.vocabMaster, context.wordStates, sessionIndex);

	return json({ sessionIndex, drillItems });
};
