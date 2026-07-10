import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/supabase', () => ({
	createServiceClient: vi.fn(() => ({}))
}));

const mocks = vi.hoisted(() => ({
	verifyListOwnership: vi.fn(),
	fetchDrillContext: vi.fn(),
	startSession: vi.fn()
}));

vi.mock('$lib/server/user-list-repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/user-list-repository')>();
	return { ...actual, verifyListOwnership: mocks.verifyListOwnership };
});

vi.mock('$lib/server/drill-repository', () => ({
	fetchDrillContext: mocks.fetchDrillContext,
	startSession: mocks.startSession
}));

import { POST } from './+server';
import { ListNotFoundError } from '$lib/server/user-list-repository';

function makeEvent(
	body: unknown,
	{ userId, ip = '203.0.113.1' }: { userId?: number; ip?: string } = { userId: 1 }
) {
	const request = new Request('http://localhost/api/session/start', {
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

describe('POST /api/session/start', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('rejects with 401 and never calls verifyListOwnership when unauthenticated', async () => {
		try {
			await POST(makeEvent({ listId: 1 }, { userId: undefined }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 401)).toBe(true);
		}
		expect(mocks.verifyListOwnership).not.toHaveBeenCalled();
	});

	it('rejects with 403 when the list does not belong to the user', async () => {
		mocks.verifyListOwnership.mockRejectedValueOnce(new ListNotFoundError());
		try {
			await POST(makeEvent({ listId: 1 }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 403)).toBe(true);
		}
	});

	it('verifies ownership before reading drill context, then returns the new session', async () => {
		const callOrder: string[] = [];
		mocks.verifyListOwnership.mockImplementationOnce(async () => {
			callOrder.push('verify');
		});
		mocks.fetchDrillContext.mockImplementationOnce(async () => {
			callOrder.push('fetch');
			return { vocabMaster: [], wordStates: [], sessionIndex: 0 };
		});
		mocks.startSession.mockImplementationOnce(async () => {
			callOrder.push('start');
			return 5;
		});

		const response = await POST(makeEvent({ listId: 1 }, { userId: 2 }));
		const body = await response.json();

		expect(body).toEqual({ sessionIndex: 5, drillItems: [] });
		expect(mocks.verifyListOwnership).toHaveBeenCalledWith(expect.anything(), 1, 2);
		expect(callOrder).toEqual(['verify', 'fetch', 'start']);
	});

	it('rejects with 429 once the per-IP rate limit is exceeded', async () => {
		mocks.verifyListOwnership.mockImplementation(async () => {});
		mocks.fetchDrillContext.mockImplementation(async () => ({
			vocabMaster: [],
			wordStates: [],
			sessionIndex: 0
		}));
		mocks.startSession.mockImplementation(async () => 1);

		const ip = `198.51.100.${Math.floor(Math.random() * 255)}`;
		for (let i = 0; i < 20; i++) {
			await POST(makeEvent({ listId: 1 }, { userId: 1, ip }));
		}
		try {
			await POST(makeEvent({ listId: 1 }, { userId: 1, ip }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 429)).toBe(true);
		}
	});
});
