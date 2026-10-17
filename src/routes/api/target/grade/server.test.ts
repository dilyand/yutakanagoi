import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/supabase', () => ({ createServiceClient: vi.fn(() => ({})) }));

const mocks = vi.hoisted(() => ({ verifyUserExists: vi.fn(), gradeAnswers: vi.fn() }));

vi.mock('$lib/server/conjugation-auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/conjugation-auth')>();
	return { ...actual, verifyUserExists: mocks.verifyUserExists };
});
vi.mock('$lib/server/target-practice/grade', () => ({ gradeAnswers: mocks.gradeAnswers }));

import { POST } from './+server';
import { UserNotFoundError } from '$lib/server/conjugation-auth';
import { grammarKakadouka } from '$lib/target-practice/fixtures';

const card = grammarKakadouka.card;
const typed = {
	mode: 'typed',
	instruction: 'Fill the blank.',
	sentence: '行くか＿＿分からない。',
	cue: '',
	answer: 'どうか',
	accepted: ['どうか'],
	learnerAnswer: 'どうか'
};
const use = {
	mode: 'use',
	instruction: 'Write your own sentence.',
	sentence: '',
	expected: [],
	free: true,
	learnerAnswer: '彼が来るかどうか知りません。'
};

let nextIp = 0;
function makeEvent({
	userId = 1,
	ip = `198.51.100.${(nextIp++ % 250) + 1}`,
	body = { type: 'grammar', card, items: [typed] }
}: { userId?: number | null; ip?: string; body?: unknown } = {}) {
	return {
		request: { json: async () => body },
		getClientAddress: () => ip,
		locals: { userId: userId ?? undefined }
	} as unknown as Parameters<typeof POST>[0];
}

async function status(promise: unknown): Promise<number> {
	try {
		await promise;
	} catch (e) {
		for (const s of [400, 401, 403, 429]) if (isHttpError(e, s)) return s;
		throw e;
	}
	return 200;
}

afterEach(() => vi.clearAllMocks());

describe('POST /api/target/grade', () => {
	it('rejects with 401 when unauthenticated', async () => {
		expect(await status(POST(makeEvent({ userId: null })))).toBe(401);
		expect(mocks.gradeAnswers).not.toHaveBeenCalled();
	});

	it('rejects a malformed body with 400', async () => {
		for (const body of [
			{ type: 'grammar', card },
			{ type: 'grammar', card, items: [] },
			{ type: 'grammar', card, items: [typed, typed, typed, typed, typed] },
			{ type: 'grammar', card, items: [{ ...typed, mode: 'other' }] },
			{ type: 'grammar', card, items: [{ ...typed, learnerAnswer: 'あ'.repeat(301) }] },
			{ type: 'grammar', card, items: [{ ...use, free: 'yes' }] },
			{ type: 'nonsense', card, items: [typed] }
		]) {
			expect(await status(POST(makeEvent({ body })))).toBe(400);
		}
		expect(mocks.gradeAnswers).not.toHaveBeenCalled();
	});

	it('rejects an invalid or oversized card before grading', async () => {
		for (const bad of [
			{ ...card, form: 5 },
			{ ...card, rule: 'あ'.repeat(9000) }
		]) {
			expect(
				await status(POST(makeEvent({ body: { type: 'grammar', card: bad, items: [typed] } })))
			).toBe(400);
		}
		expect(mocks.gradeAnswers).not.toHaveBeenCalled();
	});

	it('rejects with 403 when the user does not exist', async () => {
		mocks.verifyUserExists.mockRejectedValueOnce(new UserNotFoundError());
		expect(await status(POST(makeEvent()))).toBe(403);
		expect(mocks.gradeAnswers).not.toHaveBeenCalled();
	});

	it('grades for the session user with the validated card', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.gradeAnswers.mockResolvedValueOnce({
			status: 'ok',
			results: [{ correct: true, feedback: 'ok' }, null]
		});
		const response = await POST(
			makeEvent({
				userId: 7,
				body: { type: 'grammar', card, items: [typed, use], userId: 99 }
			})
		);
		expect(await response.json()).toEqual({
			status: 'ok',
			results: [{ correct: true, feedback: 'ok' }, null]
		});
		const [, userId, passedCard, items] = mocks.gradeAnswers.mock.calls[0];
		expect(userId).toBe(7);
		expect(passedCard).toEqual(card);
		expect(items).toEqual([typed, use]);
	});

	it('limits bursts per IP with 429', async () => {
		mocks.verifyUserExists.mockResolvedValue(undefined);
		mocks.gradeAnswers.mockResolvedValue({ status: 'ok', results: [null] });
		const ip = '198.51.100.250';
		let last = 200;
		for (let i = 0; i < 50; i++) last = await status(POST(makeEvent({ ip })));
		expect(last).toBe(429);
	});
});
