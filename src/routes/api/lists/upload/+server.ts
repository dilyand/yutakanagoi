import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { requireAppSecret } from '$lib/server/require-app-secret';
import { createServiceClient } from '$lib/server/supabase';
import { createWordList, ListNameConflictError } from '$lib/server/user-list-repository';

const RequestSchema = z.object({
	userId: z.number().int(),
	name: z.string().min(1),
	words: z.array(z.string())
});

// List name = the uploaded filename, per the app's convention. Re-uploading a
// name this user already has is rejected (409) rather than silently
// overwriting that list's progress.
export const POST: RequestHandler = async ({ request }) => {
	requireAppSecret(request);

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
