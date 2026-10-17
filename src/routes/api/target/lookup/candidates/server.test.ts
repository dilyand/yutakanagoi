import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/supabase', () => ({ createServiceClient: vi.fn(() => ({})) }));

const mocks = vi.hoisted(() => ({ verifyUserExists: vi.fn(), lookupCandidates: vi.fn() }));

vi.mock('$lib/server/conjugation-auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/conjugation-auth')>();
	return { ...actual, verifyUserExists: mocks.verifyUserExists };
});
vi.mock('$lib/server/target-practice/lookup', () => ({ lookupCandidates: mocks.lookupCandidates }));

import { POST } from './+server';
import { UserNotFoundError } from '$lib/server/conjugation-auth';

function makeEvent({
	userId = 1,
	ip = '203.0.113.1',
	body = { type: 'word', input: 'deadline' }
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

describe('POST /api/target/lookup/candidates', () => {
	it('rejects with 401 when unauthenticated', async () => {
		expect(await status(POST(makeEvent({ userId: null })))).toBe(401);
	});

	it('rejects a malformed body, an unknown type, and an over-long input with 400', async () => {
		expect(await status(POST(makeEvent({ body: { input: 'x' } })))).toBe(400);
		expect(await status(POST(makeEvent({ body: { type: 'haiku', input: 'x' } })))).toBe(400);
		expect(await status(POST(makeEvent({ body: { type: 'word', input: 'a'.repeat(201) } })))).toBe(
			400
		);
	});

	it('rejects input that fails local validation with 400, before any lookup', async () => {
		expect(
			await status(POST(makeEvent({ body: { type: 'word', input: 'run fast now please' } })))
		).toBe(400);
		expect(mocks.lookupCandidates).not.toHaveBeenCalled();
	});

	it('refuses input that needs no candidate step, so no lookup is wasted on it', async () => {
		expect(await status(POST(makeEvent({ body: { type: 'kanji', input: '解' } })))).toBe(400);
		expect(await status(POST(makeEvent({ body: { type: 'grammar', input: '〜かどうか' } })))).toBe(
			400
		);
		expect(mocks.lookupCandidates).not.toHaveBeenCalled();
	});

	it('rejects with 403 when the user does not exist', async () => {
		mocks.verifyUserExists.mockRejectedValueOnce(new UserNotFoundError());
		expect(await status(POST(makeEvent()))).toBe(403);
	});

	it('looks up with the session-derived user and the cleaned input', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.lookupCandidates.mockResolvedValueOnce({ status: 'none' });

		const response = await POST(
			makeEvent({ userId: 7, body: { type: 'grammar', input: ' Whether  or not ' } })
		);

		expect(await response.json()).toEqual({ status: 'none' });
		expect(mocks.lookupCandidates).toHaveBeenCalledWith(
			expect.anything(),
			7,
			'grammar',
			'Whether or not'
		);
	});

	it('looks up Japanese Word input too (homographs, kana-only)', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.lookupCandidates.mockResolvedValueOnce({ status: 'none' });
		await POST(makeEvent({ body: { type: 'word', input: '人気' } }));
		expect(mocks.lookupCandidates).toHaveBeenCalledWith(expect.anything(), 1, 'word', '人気');
	});

	it('passes a limit outcome through as a normal 200 response', async () => {
		const limit = {
			status: 'limit',
			reason: 'cap_reached',
			resetsAt: '2026-10-18T00:00:00.000Z',
			message: 'x'
		};
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.lookupCandidates.mockResolvedValueOnce(limit);
		const response = await POST(makeEvent());
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual(limit);
	});

	it('rejects with 429 once the per-IP burst limit is exceeded', async () => {
		mocks.verifyUserExists.mockResolvedValue(undefined);
		mocks.lookupCandidates.mockResolvedValue({ status: 'none' });
		const ip = `198.51.100.${Math.floor(Math.random() * 255)}`;
		for (let i = 0; i < 20; i++) await POST(makeEvent({ ip }));
		expect(await status(POST(makeEvent({ ip })))).toBe(429);
	});
});
