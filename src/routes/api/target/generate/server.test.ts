import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/supabase', () => ({ createServiceClient: vi.fn(() => ({})) }));

const mocks = vi.hoisted(() => ({ verifyUserExists: vi.fn(), generateStage: vi.fn() }));

vi.mock('$lib/server/conjugation-auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/conjugation-auth')>();
	return { ...actual, verifyUserExists: mocks.verifyUserExists };
});
vi.mock('$lib/server/target-practice/generate', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/target-practice/generate')>()),
	generateStage: mocks.generateStage
}));

import { POST, config } from './+server';
import { UserNotFoundError } from '$lib/server/conjugation-auth';
import { GENERATE_MAX_DURATION_S } from '$lib/server/target-practice/generate';
import {
	contrastKimeruKimaru,
	grammarKakadouka,
	wordKibishii
} from '$lib/target-practice/fixtures';

const card = grammarKakadouka.card;

// A fresh IP per event, so the per-IP burst limiter only trips where a test asks for it.
let nextIp = 0;

function makeEvent({
	userId = 1,
	ip = `203.0.113.${(nextIp++ % 250) + 1}`,
	body = { stage: 1, type: 'grammar', card }
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

describe('POST /api/target/generate', () => {
	it('sets an explicit maxDuration matching the service budget', () => {
		expect(config.maxDuration).toBe(GENERATE_MAX_DURATION_S);
	});

	it('rejects with 401 when unauthenticated', async () => {
		expect(await status(POST(makeEvent({ userId: null })))).toBe(401);
		expect(mocks.generateStage).not.toHaveBeenCalled();
	});

	it('rejects a malformed body with 400', async () => {
		for (const body of [
			{ type: 'grammar', card },
			{ stage: 3, type: 'grammar', card },
			{ stage: 1, type: 'nonsense', card },
			{ stage: 1, type: 'grammar' },
			{ stage: 1, type: 'grammar', card, retry: 'yes' },
			{ stage: 1, type: 'grammar', card, avoid: ['x'.repeat(201)] },
			{ stage: 1, type: 'grammar', card, avoid: new Array(41).fill('文') }
		]) {
			expect(await status(POST(makeEvent({ body })))).toBe(400);
		}
		expect(mocks.generateStage).not.toHaveBeenCalled();
	});

	it('rejects a card that fails validateCard, before anything is generated', async () => {
		const bad = { ...card, form: 5 };
		expect(await status(POST(makeEvent({ body: { stage: 1, type: 'grammar', card: bad } })))).toBe(
			400
		);
		// Valid card, wrong type for it.
		expect(await status(POST(makeEvent({ body: { stage: 1, type: 'word', card } })))).toBe(400);
		// A rejection stub is not a card.
		expect(
			await status(
				POST(
					makeEvent({
						body: { stage: 1, type: 'grammar', card: { ok: false, reason: 'x' } }
					})
				)
			)
		).toBe(400);
		expect(mocks.generateStage).not.toHaveBeenCalled();
	});

	it('rejects an oversized card and a card whose target is not valid input', async () => {
		const huge = { ...card, rule: 'あ'.repeat(9000) };
		expect(await status(POST(makeEvent({ body: { stage: 1, type: 'grammar', card: huge } })))).toBe(
			400
		);
		const badTarget = { ...card, target: 'whether' };
		expect(
			await status(POST(makeEvent({ body: { stage: 1, type: 'grammar', card: badTarget } })))
		).toBe(400);
		expect(mocks.generateStage).not.toHaveBeenCalled();
	});

	it('rejects with 403 when the user does not exist', async () => {
		mocks.verifyUserExists.mockRejectedValueOnce(new UserNotFoundError());
		expect(await status(POST(makeEvent()))).toBe(403);
		expect(mocks.generateStage).not.toHaveBeenCalled();
	});

	it('generates from the validated card and the session user, never a client id', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.generateStage.mockResolvedValueOnce({ status: 'ok', stage: 2, items: [] });

		const response = await POST(
			makeEvent({
				userId: 7,
				body: { stage: 2, type: 'grammar', card, retry: true, avoid: ['昨日は雨でした。'] }
			})
		);

		expect(await response.json()).toEqual({ status: 'ok', stage: 2, items: [] });
		expect(mocks.generateStage).toHaveBeenCalledWith(expect.anything(), 7, {
			stage: 2,
			card,
			retry: true,
			avoid: ['昨日は雨でした。']
		});
	});

	it('defaults retry to false and avoid to empty', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.generateStage.mockResolvedValueOnce({ status: 'ok' });
		await POST(makeEvent({ body: { stage: 1, type: 'word', card: wordKibishii.card } }));
		expect(mocks.generateStage).toHaveBeenCalledWith(expect.anything(), 1, {
			stage: 1,
			card: wordKibishii.card,
			retry: false,
			avoid: []
		});
	});

	it('accepts a Contrast card (display-form target)', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.generateStage.mockResolvedValueOnce({ status: 'ok' });
		const { card: contrast } = contrastKimeruKimaru;
		expect(
			await status(POST(makeEvent({ body: { stage: 1, type: 'contrast', card: contrast } })))
		).toBe(200);
	});

	it('passes a limit outcome through as a normal 200 response', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		const limit = { status: 'limit', reason: 'cap_reached', resetsAt: 'x', message: 'y' };
		mocks.generateStage.mockResolvedValueOnce(limit);
		const response = await POST(makeEvent());
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(limit);
	});

	it('rejects with 429 once the per-IP burst limit is exceeded', async () => {
		mocks.verifyUserExists.mockResolvedValue(undefined);
		mocks.generateStage.mockResolvedValue({ status: 'ok' });
		const ip = `198.51.100.${Math.floor(Math.random() * 255)}`;
		for (let i = 0; i < 12; i++) await POST(makeEvent({ ip }));
		expect(await status(POST(makeEvent({ ip })))).toBe(429);
	});
});
