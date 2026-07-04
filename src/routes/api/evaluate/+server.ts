import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { evaluate } from '$lib/server/claude-evaluate';
import { requireAppSecret } from '$lib/server/require-app-secret';

const RequestSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('grade_answer'), word: z.string(), userAnswer: z.string() }),
	z.object({ mode: z.literal('explain_word'), word: z.string() }),
	z.object({ mode: z.literal('evaluate_sentence'), word: z.string(), sentence: z.string() })
]);

// The only server-side gate on Claude API spend: a shared secret checked before
// any Anthropic call is made. The passphrase UI (PassphraseGate.svelte) is what
// obtains this secret from the user and attaches it as the Authorization header.
export const POST: RequestHandler = async ({ request }) => {
	requireAppSecret(request);

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) {
		error(400, 'Invalid request body');
	}

	const result = await evaluate(parsedBody.data);
	return json(result);
};
