import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/supabase', () => ({ createServiceClient: vi.fn(() => ({})) }));

const mocks = vi.hoisted(() => ({ verifyUserExists: vi.fn(), lookupCard: vi.fn() }));

vi.mock('$lib/server/conjugation-auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/conjugation-auth')>();
	return { ...actual, verifyUserExists: mocks.verifyUserExists };
});
vi.mock('$lib/server/target-practice/lookup', () => ({ lookupCard: mocks.lookupCard }));

import { POST, config } from './+server';
import { UserNotFoundError } from '$lib/server/conjugation-auth';

function makeEvent({
	userId = 1,
	ip = '203.0.113.1',
	body = { type: 'word', target: '厳しい' }
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

describe('POST /api/target/lookup/card', () => {
	it('sets an explicit maxDuration', () => {
		expect(config.maxDuration).toBe(60);
	});

	it('rejects with 401 when unauthenticated', async () => {
		expect(await status(POST(makeEvent({ userId: null })))).toBe(401);
	});

	it('rejects a malformed body with 400', async () => {
		expect(await status(POST(makeEvent({ body: { target: '厳しい' } })))).toBe(400);
		expect(
			await status(
				POST(makeEvent({ body: { type: 'word', target: '厳しい', reading: 'x'.repeat(101) } }))
			)
		).toBe(400);
	});

	it('rejects English targets and invalid input with 400 (the card is built from Japanese only)', async () => {
		expect(await status(POST(makeEvent({ body: { type: 'word', target: 'deadline' } })))).toBe(400);
		expect(await status(POST(makeEvent({ body: { type: 'kanji', target: '理解' } })))).toBe(400);
		expect(mocks.lookupCard).not.toHaveBeenCalled();
	});

	it('rejects a non-kana reading on the untrusted candidate fields with 400', async () => {
		expect(
			await status(
				POST(makeEvent({ body: { type: 'word', target: '厳しい', reading: 'kibishii' } }))
			)
		).toBe(400);
	});

	it('rejects with 403 when the user does not exist', async () => {
		mocks.verifyUserExists.mockRejectedValueOnce(new UserNotFoundError());
		expect(await status(POST(makeEvent()))).toBe(403);
	});

	it('builds the confirmed target from the validated body and the session user', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.lookupCard.mockResolvedValueOnce({ status: 'rejected', reason: 'x' });

		const response = await POST(
			makeEvent({
				userId: 7,
				body: { type: 'word', target: '人気', reading: 'ひとけ', gloss: 'signs of people' }
			})
		);

		expect(await response.json()).toEqual({ status: 'rejected', reason: 'x' });
		expect(mocks.lookupCard).toHaveBeenCalledWith(expect.anything(), 7, {
			type: 'word',
			target: '人気',
			reading: 'ひとけ',
			gloss: 'signs of people'
		});
	});

	it('carries a Contrast pair as typed', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.lookupCard.mockResolvedValueOnce({ status: 'rejected', reason: 'x' });
		await POST(makeEvent({ body: { type: 'contrast', target: '決める / 決まる' } }));
		expect(mocks.lookupCard).toHaveBeenCalledWith(expect.anything(), 1, {
			type: 'contrast',
			target: '決める vs 決まる',
			sides: ['決める', '決まる']
		});
	});

	it('rejects with 429 once the per-IP burst limit is exceeded', async () => {
		mocks.verifyUserExists.mockResolvedValue(undefined);
		mocks.lookupCard.mockResolvedValue({ status: 'rejected', reason: 'x' });
		const ip = `198.51.100.${Math.floor(Math.random() * 255)}`;
		for (let i = 0; i < 20; i++) await POST(makeEvent({ ip }));
		expect(await status(POST(makeEvent({ ip })))).toBe(429);
	});
});
