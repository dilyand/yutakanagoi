import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAppSecret } from '$lib/server/require-app-secret';
import { createServiceClient } from '$lib/server/supabase';
import { fetchDrillContext, startSession } from '$lib/server/drill-repository';
import { selectDrillWords } from '$lib/drill-algorithm';

// Starting a session is a deliberate action (not tied to page load) so that
// refreshing the drill page never accidentally increments session_index.
export const POST: RequestHandler = async ({ request }) => {
	requireAppSecret(request);

	const supabase = createServiceClient();
	const context = await fetchDrillContext(supabase);
	const sessionIndex = await startSession(supabase);
	const drillItems = selectDrillWords(context.vocabMaster, context.wordStates, sessionIndex);

	return json({ sessionIndex, drillItems });
};
