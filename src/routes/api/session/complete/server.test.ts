import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const mockEnv = vi.hoisted(() => ({ APP_SHARED_SECRET: 'correct-secret' as string | undefined }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

vi.mock('$lib/server/supabase', () => ({
	createServiceClient: vi.fn(() => ({}))
}));

const mocks = vi.hoisted(() => ({
	verifyListOwnership: vi.fn(),
	upsertWordStates: vi.fn(),
	insertSessionAttempts: vi.fn(),
	completeSession: vi.fn()
}));

vi.mock('$lib/server/user-list-repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/user-list-repository')>();
	return { ...actual, verifyListOwnership: mocks.verifyListOwnership };
});

vi.mock('$lib/server/drill-repository', () => ({
	upsertWordStates: mocks.upsertWordStates,
	insertSessionAttempts: mocks.insertSessionAttempts,
	completeSession: mocks.completeSession
}));

import { POST } from './+server';
import { ListNotFoundError } from '$lib/server/user-list-repository';

const validBody = {
	listId: 1,
	userId: 2,
	sessionIndex: 5,
	wordStates: [{ word: '一', box: 1, lastSession: 5 }],
	attempts: [{ word: '一', wasNewWord: false, correct: true, boxBefore: 0, boxAfter: 1 }]
};

function makeEvent(
	body: unknown,
	{ authHeader, ip = '203.0.113.1' }: { authHeader?: string; ip?: string } = {
		authHeader: 'Bearer correct-secret'
	}
) {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (authHeader !== undefined) headers.Authorization = authHeader;
	const request = new Request('http://localhost/api/session/complete', {
		method: 'POST',
		headers,
		body: JSON.stringify(body)
	});
	return { request, getClientAddress: () => ip } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/session/complete', () => {
	afterEach(() => {
		mockEnv.APP_SHARED_SECRET = 'correct-secret';
		vi.clearAllMocks();
	});

	it('rejects with 401 and never calls verifyListOwnership when unauthenticated', async () => {
		try {
			await POST(makeEvent(validBody, { authHeader: undefined }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 401)).toBe(true);
		}
		expect(mocks.verifyListOwnership).not.toHaveBeenCalled();
	});

	it('rejects with 403 when the list does not belong to the user', async () => {
		mocks.verifyListOwnership.mockRejectedValueOnce(new ListNotFoundError());
		try {
			await POST(makeEvent(validBody));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 403)).toBe(true);
		}
		expect(mocks.upsertWordStates).not.toHaveBeenCalled();
	});

	it('verifies ownership before persisting, then returns ok', async () => {
		const callOrder: string[] = [];
		mocks.verifyListOwnership.mockImplementationOnce(async () => {
			callOrder.push('verify');
		});
		mocks.upsertWordStates.mockImplementationOnce(async () => {
			callOrder.push('upsert');
		});
		mocks.insertSessionAttempts.mockImplementationOnce(async () => {
			callOrder.push('attempts');
		});
		mocks.completeSession.mockImplementationOnce(async () => {
			callOrder.push('complete');
		});

		const response = await POST(makeEvent(validBody));
		const body = await response.json();

		expect(body).toEqual({ ok: true });
		expect(mocks.verifyListOwnership).toHaveBeenCalledWith(expect.anything(), 1, 2);
		expect(callOrder).toEqual(['verify', 'upsert', 'attempts', 'complete']);
	});

	it('rejects with 429 once the per-IP rate limit is exceeded', async () => {
		mocks.verifyListOwnership.mockImplementation(async () => {});
		mocks.upsertWordStates.mockImplementation(async () => {});
		mocks.insertSessionAttempts.mockImplementation(async () => {});
		mocks.completeSession.mockImplementation(async () => {});

		const ip = `198.51.100.${Math.floor(Math.random() * 255)}`;
		for (let i = 0; i < 20; i++) {
			await POST(makeEvent(validBody, { authHeader: 'Bearer correct-secret', ip }));
		}
		try {
			await POST(makeEvent(validBody, { authHeader: 'Bearer correct-secret', ip }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 429)).toBe(true);
		}
	});
});
