import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { env } from '$env/dynamic/private';
import { z } from 'zod';
import { evaluate } from '$lib/server/claude-evaluate';

const RequestSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('grade_answer'), word: z.string(), userAnswer: z.string() }),
	z.object({ mode: z.literal('explain_word'), word: z.string() }),
	z.object({ mode: z.literal('evaluate_sentence'), word: z.string(), sentence: z.string() })
]);

// The only server-side gate on Claude API spend: a shared secret checked before
// any Anthropic call is made. Full passphrase UI comes in a later issue — this
// just enforces the header. See the access-control design in the PWA migration plan.
export const POST: RequestHandler = async ({ request }) => {
	const expectedSecret = env.APP_SHARED_SECRET;
	if (!expectedSecret) {
		error(500, 'APP_SHARED_SECRET is not configured.');
	}

	const authHeader = request.headers.get('authorization');
	const providedSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
	if (providedSecret !== expectedSecret) {
		error(401, 'Unauthorized');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) {
		error(400, 'Invalid request body');
	}

	const result = await evaluate(parsedBody.data);
	return json(result);
};
