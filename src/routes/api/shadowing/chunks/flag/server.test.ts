import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/supabase', () => ({
	createServiceClient: vi.fn(() => ({}))
}));

const mocks = vi.hoisted(() => ({
	verifyUserExists: vi.fn(),
	flagChunk: vi.fn()
}));

vi.mock('$lib/server/conjugation-auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/conjugation-auth')>();
	return { ...actual, verifyUserExists: mocks.verifyUserExists };
});

vi.mock('$lib/server/shadowing-repository', () => ({
	flagChunk: mocks.flagChunk
}));

import { POST } from './+server';
import { UserNotFoundError } from '$lib/server/conjugation-auth';

function makeEvent(
	{ userId, ip = '203.0.113.1', body }: { userId?: number; ip?: string; body?: unknown } = {
		userId: 1
	}
) {
	return {
		request: { json: async () => body ?? { chunkId: 'rec:1:00', note: 'clipped audio' } },
		getClientAddress: () => ip,
		locals: { userId }
	} as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/shadowing/chunks/flag', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('rejects with 401 when unauthenticated', async () => {
		try {
			await POST(makeEvent({ userId: undefined }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 401)).toBe(true);
		}
	});

	it('rejects with 400 on a missing chunkId', async () => {
		try {
			await POST(makeEvent({ userId: 1, body: { note: 'no chunkId here' } }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 400)).toBe(true);
		}
	});

	it('rejects with 403 when the user does not exist', async () => {
		mocks.verifyUserExists.mockRejectedValueOnce(new UserNotFoundError());
		try {
			await POST(makeEvent({ userId: 1 }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 403)).toBe(true);
		}
	});

	it('flags the chunk scoped to the session-derived user, with the given note', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.flagChunk.mockResolvedValueOnce(undefined);

		const response = await POST(makeEvent({ userId: 7 }));
		const body = await response.json();

		expect(body).toEqual({ ok: true });
		expect(mocks.flagChunk).toHaveBeenCalledWith(expect.anything(), 7, 'rec:1:00', 'clipped audio');
	});

	it('flags the chunk with an undefined note when none is given', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.flagChunk.mockResolvedValueOnce(undefined);

		await POST(makeEvent({ userId: 1, body: { chunkId: 'rec:1:00' } }));

		expect(mocks.flagChunk).toHaveBeenCalledWith(expect.anything(), 1, 'rec:1:00', undefined);
	});

	it('rejects with 429 once the per-IP rate limit is exceeded', async () => {
		mocks.verifyUserExists.mockResolvedValue(undefined);
		mocks.flagChunk.mockResolvedValue(undefined);

		const ip = `198.51.100.${Math.floor(Math.random() * 255)}`;
		for (let i = 0; i < 10; i++) {
			await POST(makeEvent({ userId: 1, ip }));
		}
		try {
			await POST(makeEvent({ userId: 1, ip }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 429)).toBe(true);
		}
	});
});
