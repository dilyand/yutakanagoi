import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireAppSecret } from '$lib/server/require-app-secret';
import { createServiceClient } from '$lib/server/supabase';
import { fetchConjugationContext, startSession } from '$lib/server/conjugation-repository';
import { verifyUserExists, UserNotFoundError } from '$lib/server/conjugation-auth';
import { checkRateLimit } from '$lib/server/rate-limit';
import { selectDrillWords } from '$lib/drill-algorithm';
import { buildConjugationRegistry, pickWordForCell } from '$lib/conjugation-engine';
import { CONJUGATION_WORDS } from '$lib/conjugation-word-list';

const RequestSchema = z.object({ userId: z.number().int() });

// Separate bucket from vocab's session-start limit (not shared) so the two
// activities can't starve each other's rate-limit budget. Same 20/5min
// shape for the same reason vocab's has it: bounds a runaway client-side
// retry loop from inflating session_index.
const LIMIT = 20;
const WINDOW_MS = 5 * 60 * 1000;

export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	requireAppSecret(request);
	if (!checkRateLimit(`conjugation-session-start:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) {
		error(400, 'Invalid request body');
	}
	const { userId } = parsedBody.data;

	const supabase = createServiceClient();
	try {
		await verifyUserExists(supabase, userId);
	} catch (e) {
		if (e instanceof UserNotFoundError) error(403, e.message);
		throw e;
	}

	const context = await fetchConjugationContext(supabase, userId);
	const sessionIndex = await startSession(supabase, userId);

	// The registry has no inherent "frequency" — its array index (form-major,
	// see buildConjugationRegistry's comment) doubles as the new-cell
	// introduction order selectDrillWords expects from a frequencyRank.
	const registry = buildConjugationRegistry();
	const cellById = new Map(registry.map((cell) => [cell.id, cell]));
	const registryAsVocab = registry.map((cell, index) => ({ word: cell.id, frequencyRank: index }));

	const drillItems = selectDrillWords(registryAsVocab, context.cellStates, sessionIndex).map(
		(item) => {
			const cell = cellById.get(item.word);
			if (!cell) throw new Error(`Unknown cell id from selectDrillWords: ${item.word}`);
			// The word actually shown is picked fresh each time — progress is
			// tracked per (wordClass, formId) cell, not per word (see
			// pickWordForCell's doc comment).
			const picked = pickWordForCell(cell.wordClass, cell.formId, CONJUGATION_WORDS);
			return {
				...item,
				cellId: cell.id,
				wordClass: cell.wordClass,
				formId: cell.formId,
				word: picked.word
			};
		}
	);

	return json({ sessionIndex, drillItems });
};
