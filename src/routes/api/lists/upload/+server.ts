import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireAppSecret } from '$lib/server/require-app-secret';
import { createServiceClient } from '$lib/server/supabase';
import { createWordList, ListNameConflictError } from '$lib/server/user-list-repository';
import { checkRateLimit } from '$lib/server/rate-limit';

// Uploads are rare/deliberate (new word list), so 5/hour per IP is generous
// headroom while bounding spam.
const LIMIT = 5;
const WINDOW_MS = 60 * 60 * 1000;

// The reference 2000-word list tops out at 18 chars/word, so 50/3000 leaves
// generous headroom while still bounding what ends up in every drill prompt
// for this list (see claude-evaluate.ts).
const RequestSchema = z.object({
	userId: z.number().int(),
	name: z.string().min(1).max(200),
	words: z.array(z.string().max(50)).max(3000)
});

// List name = the uploaded filename, per the app's convention. Re-uploading a
// name this user already has is rejected (409) rather than silently
// overwriting that list's progress.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	requireAppSecret(request);
	if (!checkRateLimit(`lists-upload:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many uploads — please wait and try again.');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) {
		error(400, 'Invalid request body');
	}
	const { userId, name, words } = parsedBody.data;

	const cleanedWords = words.map((w) => w.trim()).filter((w) => w.length > 0);
	if (cleanedWords.length === 0) {
		error(400, 'Word list is empty');
	}

	const supabase = createServiceClient();
	try {
		const listId = await createWordList(supabase, userId, name, cleanedWords);
		return json({ listId });
	} catch (e) {
		if (e instanceof ListNameConflictError) {
			error(409, e.message);
		}
		throw e;
	}
};
