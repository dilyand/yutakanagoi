import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { evaluate } from '$lib/server/claude-evaluate';
import { requireAppSecret } from '$lib/server/require-app-secret';
import { checkRateLimit } from '$lib/server/rate-limit';

// Every call here costs a Claude API request. Originally 30/5min sized for
// vocab drill's call volume (max 10 words/session, ~1-2 calls each); raised
// to 45 for conjugation drill's grading order (exact-match first, so up to
// 2 more calls only on the paths that need them: conjugation_leniency_check
// on a mismatch, then conjugation_hint or conjugation_example) — a 10-cell
// session's worst case is 10 x 3 = 30, which left no headroom at the old
// limit alongside any vocab-drill calls sharing the same per-IP bucket.
const LIMIT = 45;
const WINDOW_MS = 5 * 60 * 1000;

// Bounds are defense in depth against unbounded prompt content driving up
// Claude API cost/latency — word already gets a tighter cap at list-upload
// time (see lists/upload/+server.ts), but this endpoint doesn't know where
// its `word` came from, so it enforces its own limit too.
const word = z.string().max(100);
const freeText = z.string().max(500);
// wordClass/formId are fixed-format identifiers from $lib/conjugation-forms
// (e.g. "godan_ru", "causative_passive_past") — real values are well under
// this, generous headroom is just defense in depth.
const shortIdentifier = z.string().max(50);

const RequestSchema = z.discriminatedUnion('mode', [
	z.object({ mode: z.literal('grade_answer'), word, userAnswer: freeText }),
	z.object({ mode: z.literal('explain_word'), word }),
	z.object({ mode: z.literal('evaluate_sentence'), word, sentence: freeText }),
	z.object({
		mode: z.literal('conjugation_hint'),
		word,
		wordClass: shortIdentifier,
		formId: shortIdentifier,
		userAnswer: freeText,
		canonicalAnswer: word
	}),
	z.object({ mode: z.literal('conjugation_example'), word, meaning: word, conjugatedForm: word }),
	z.object({
		mode: z.literal('conjugation_leniency_check'),
		canonicalAnswer: word,
		userAnswer: freeText
	})
]);

// The only server-side gate on Claude API spend: a shared secret checked before
// any Anthropic call is made. The passphrase UI (PassphraseGate.svelte) is what
// obtains this secret from the user and attaches it as the Authorization header.
export const POST: RequestHandler = async ({ request, getClientAddress }) => {
	requireAppSecret(request);
	if (!checkRateLimit(`evaluate:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) {
		error(400, 'Invalid request body');
	}

	const result = await evaluate(parsedBody.data);
	return json(result);
};
