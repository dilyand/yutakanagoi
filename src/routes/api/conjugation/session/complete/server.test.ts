import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/supabase', () => ({
	createServiceClient: vi.fn(() => ({}))
}));

const mocks = vi.hoisted(() => ({
	verifyUserExists: vi.fn(),
	upsertCellStates: vi.fn(),
	insertSessionAttempts: vi.fn(),
	completeSession: vi.fn()
}));

vi.mock('$lib/server/conjugation-auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/conjugation-auth')>();
	return { ...actual, verifyUserExists: mocks.verifyUserExists };
});

vi.mock('$lib/server/conjugation-repository', () => ({
	upsertCellStates: mocks.upsertCellStates,
	insertSessionAttempts: mocks.insertSessionAttempts,
	completeSession: mocks.completeSession
}));

import { POST } from './+server';
import { UserNotFoundError } from '$lib/server/conjugation-auth';

const VALID_BODY = {
	sessionIndex: 5,
	cellStates: [{ cellId: 'godan_ru:nai', box: 1, lastSession: 5, box4Streak: 0 }],
	attempts: [
		{
			cellId: 'godan_ru:nai',
			word: '帰る',
			wasNewCell: true,
			correct: true,
			boxBefore: 0,
			boxAfter: 1,
			attemptsUsed: 1
		}
	]
};

function makeEvent(
	body: unknown,
	{ userId, ip = '203.0.113.1' }: { userId?: number; ip?: string } = { userId: 2 }
) {
	const request = new Request('http://localhost/api/conjugation/session/complete', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(body)
	});
	return {
		request,
		getClientAddress: () => ip,
		locals: { userId }
	} as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/conjugation/session/complete', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('rejects with 401 and never calls verifyUserExists when unauthenticated', async () => {
		try {
			await POST(makeEvent(VALID_BODY, { userId: undefined }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 401)).toBe(true);
		}
		expect(mocks.verifyUserExists).not.toHaveBeenCalled();
	});

	it('rejects with 403 when the user does not exist', async () => {
		mocks.verifyUserExists.mockRejectedValueOnce(new UserNotFoundError());
		try {
			await POST(makeEvent(VALID_BODY));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 403)).toBe(true);
		}
	});

	it('rejects with 400 on a malformed body', async () => {
		try {
			await POST(makeEvent({}));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 400)).toBe(true);
		}
	});

	it('verifies the user before persisting, in cell-states -> attempts -> complete order', async () => {
		const callOrder: string[] = [];
		mocks.verifyUserExists.mockImplementationOnce(async () => {
			callOrder.push('verify');
		});
		mocks.upsertCellStates.mockImplementationOnce(async () => {
			callOrder.push('upsertCellStates');
		});
		mocks.insertSessionAttempts.mockImplementationOnce(async () => {
			callOrder.push('insertSessionAttempts');
		});
		mocks.completeSession.mockImplementationOnce(async () => {
			callOrder.push('completeSession');
		});

		const response = await POST(makeEvent(VALID_BODY));
		const body = await response.json();

		expect(body).toEqual({ ok: true });
		expect(mocks.verifyUserExists).toHaveBeenCalledWith(expect.anything(), 2);
		expect(mocks.upsertCellStates).toHaveBeenCalledWith(expect.anything(), 2, [
			{ word: 'godan_ru:nai', box: 1, lastSession: 5, box4Streak: 0 }
		]);
		expect(mocks.completeSession).toHaveBeenCalledWith(expect.anything(), 2, 5, 1);
		expect(callOrder).toEqual([
			'verify',
			'upsertCellStates',
			'insertSessionAttempts',
			'completeSession'
		]);
	});

	it('rejects with 429 once the per-IP rate limit is exceeded', async () => {
		mocks.verifyUserExists.mockImplementation(async () => {});
		mocks.upsertCellStates.mockImplementation(async () => {});
		mocks.insertSessionAttempts.mockImplementation(async () => {});
		mocks.completeSession.mockImplementation(async () => {});

		const ip = `198.51.100.${Math.floor(Math.random() * 255)}`;
		for (let i = 0; i < 20; i++) {
			await POST(makeEvent(VALID_BODY, { userId: 2, ip }));
		}
		try {
			await POST(makeEvent(VALID_BODY, { userId: 2, ip }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 429)).toBe(true);
		}
	});
});
