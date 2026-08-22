import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/supabase', () => ({
	createServiceClient: vi.fn(() => ({}))
}));

const mocks = vi.hoisted(() => ({
	verifyUserExists: vi.fn(),
	upsertChunkStates: vi.fn(),
	insertSessionAttempts: vi.fn(),
	completeSession: vi.fn()
}));

vi.mock('$lib/server/conjugation-auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/conjugation-auth')>();
	return { ...actual, verifyUserExists: mocks.verifyUserExists };
});

vi.mock('$lib/server/shadowing-repository', () => ({
	upsertChunkStates: mocks.upsertChunkStates,
	insertSessionAttempts: mocks.insertSessionAttempts,
	completeSession: mocks.completeSession
}));

import { POST } from './+server';
import { UserNotFoundError } from '$lib/server/conjugation-auth';

function makeEvent(
	{ userId, ip = '203.0.113.1', body }: { userId?: number; ip?: string; body?: unknown } = {
		userId: 1
	}
) {
	return {
		request: { json: async () => body ?? validBody() },
		getClientAddress: () => ip,
		locals: { userId }
	} as unknown as Parameters<typeof POST>[0];
}

function validBody() {
	return {
		sessionIndex: 3,
		chunkStates: [{ chunkId: 'rec:1:00', box: 2, lastSession: 3, box4Streak: 0 }],
		attempts: [
			{
				chunkId: 'rec:1:00',
				wasNewChunk: false,
				hintLevel: 1,
				rating: 'good',
				replays: 2,
				boxBefore: 1,
				boxAfter: 2
			}
		]
	};
}

describe('POST /api/shadowing/session/complete', () => {
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

	it('rejects with 400 on an invalid body', async () => {
		try {
			await POST(makeEvent({ userId: 1, body: { sessionIndex: 'not-a-number' } }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 400)).toBe(true);
		}
	});

	it('rejects with 400 on an invalid rating value', async () => {
		const body = validBody();
		body.attempts[0].rating = 'terrible' as never;
		try {
			await POST(makeEvent({ userId: 1, body }));
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

	it('persists chunk states, attempts, and marks the session complete, in that order', async () => {
		const callOrder: string[] = [];
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.upsertChunkStates.mockImplementationOnce(async () => {
			callOrder.push('upsert');
		});
		mocks.insertSessionAttempts.mockImplementationOnce(async () => {
			callOrder.push('attempts');
		});
		mocks.completeSession.mockImplementationOnce(async () => {
			callOrder.push('complete');
		});

		const response = await POST(makeEvent({ userId: 5 }));
		const body = await response.json();

		expect(body).toEqual({ ok: true });
		expect(callOrder).toEqual(['upsert', 'attempts', 'complete']);
		expect(mocks.upsertChunkStates).toHaveBeenCalledWith(expect.anything(), 5, [
			{ word: 'rec:1:00', box: 2, lastSession: 3, box4Streak: 0 }
		]);
		expect(mocks.insertSessionAttempts).toHaveBeenCalledWith(
			expect.anything(),
			5,
			3,
			validBody().attempts
		);
		expect(mocks.completeSession).toHaveBeenCalledWith(expect.anything(), 5, 3, 1);
	});

	it('rejects with 429 once the per-IP rate limit is exceeded', async () => {
		mocks.verifyUserExists.mockResolvedValue(undefined);
		mocks.upsertChunkStates.mockResolvedValue(undefined);
		mocks.insertSessionAttempts.mockResolvedValue(undefined);
		mocks.completeSession.mockResolvedValue(undefined);

		const ip = `198.51.100.${Math.floor(Math.random() * 255)}`;
		for (let i = 0; i < 20; i++) {
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
