import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { createServiceClient } from '$lib/server/supabase';
import {
	renameListWord,
	verifyListOwnership,
	WordNotFoundError,
	WordConflictError,
	ListNotFoundError
} from '$lib/server/user-list-repository';
import { checkRateLimit } from '$lib/server/rate-limit';
import { requireUserId } from '$lib/server/require-session';

// A deliberate-but-more-frequent action than an upload (fixing a typo
// mid-session), so a looser bound than lists/upload's 5/hour.
const LIMIT = 30;
const WINDOW_MS = 60 * 60 * 1000;

const RequestSchema = z.object({
	listId: z.number().int().positive(),
	oldWord: z.string().min(1).max(50),
	newWord: z.string().trim().min(1).max(50)
});

export const POST: RequestHandler = async ({ request, getClientAddress, locals }) => {
	const userId = requireUserId(locals);
	if (!checkRateLimit(`lists-words-edit:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many edits — please wait and try again.');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) {
		error(400, 'Invalid request body');
	}
	const { listId, oldWord, newWord } = parsedBody.data;

	if (newWord === oldWord) {
		error(400, 'New word is the same as the current word');
	}

	const supabase = createServiceClient();
	try {
		await verifyListOwnership(supabase, listId, userId);
		await renameListWord(supabase, listId, oldWord, newWord);
		return json({ ok: true });
	} catch (e) {
		if (e instanceof ListNotFoundError) {
			error(404, e.message);
		}
		if (e instanceof WordNotFoundError) {
			error(404, e.message);
		}
		if (e instanceof WordConflictError) {
			error(409, e.message);
		}
		throw e;
	}
};
