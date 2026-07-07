import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const mockEnv = vi.hoisted(() => ({ APP_SHARED_SECRET: 'correct-secret' as string | undefined }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

vi.mock('$lib/server/supabase', () => ({
	createServiceClient: vi.fn(() => ({}))
}));

const mocks = vi.hoisted(() => ({
	verifyUserExists: vi.fn(),
	fetchConjugationContext: vi.fn(),
	startSession: vi.fn(),
	evaluate: vi.fn()
}));

vi.mock('$lib/server/conjugation-auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/conjugation-auth')>();
	return { ...actual, verifyUserExists: mocks.verifyUserExists };
});

vi.mock('$lib/server/conjugation-repository', () => ({
	fetchConjugationContext: mocks.fetchConjugationContext,
	startSession: mocks.startSession
}));

vi.mock('$lib/server/claude-evaluate', () => ({
	evaluate: mocks.evaluate
}));

import { POST } from './+server';
import { UserNotFoundError } from '$lib/server/conjugation-auth';

function makeEvent(
	body: unknown,
	{ authHeader, ip = '203.0.113.1' }: { authHeader?: string; ip?: string } = {
		authHeader: 'Bearer correct-secret'
	}
) {
	const headers: Record<string, string> = { 'content-type': 'application/json' };
	if (authHeader !== undefined) headers.Authorization = authHeader;
	const request = new Request('http://localhost/api/conjugation/session/start', {
		method: 'POST',
		headers,
		body: JSON.stringify(body)
	});
	return { request, getClientAddress: () => ip } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/conjugation/session/start', () => {
	afterEach(() => {
		mockEnv.APP_SHARED_SECRET = 'correct-secret';
		vi.clearAllMocks();
	});

	it('rejects with 401 and never calls verifyUserExists when unauthenticated', async () => {
		try {
			await POST(makeEvent({ userId: 1 }, { authHeader: undefined }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 401)).toBe(true);
		}
		expect(mocks.verifyUserExists).not.toHaveBeenCalled();
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

	it('verifies the user before reading context, then returns the new session with real drill items', async () => {
		const callOrder: string[] = [];
		mocks.verifyUserExists.mockImplementationOnce(async () => {
			callOrder.push('verify');
		});
		mocks.fetchConjugationContext.mockImplementationOnce(async () => {
			callOrder.push('fetch');
			return { cellStates: [], sessionIndex: 0 };
		});
		mocks.startSession.mockImplementationOnce(async () => {
			callOrder.push('start');
			return 5;
		});
		mocks.evaluate.mockImplementationOnce(async (req: { items: { cellId: string }[] }) => {
			callOrder.push('glosses');
			return { glosses: req.items.map((i) => ({ cellId: i.cellId, targetMeaning: 'test gloss' })) };
		});

		const response = await POST(makeEvent({ userId: 2 }));
		const body = await response.json();

		expect(body.sessionIndex).toBe(5);
		expect(body.drillItems).toHaveLength(10);
		for (const item of body.drillItems) {
			expect(item.isNew).toBe(true);
			expect(typeof item.cellId).toBe('string');
			expect(typeof item.wordClass).toBe('string');
			expect(typeof item.formId).toBe('string');
			expect(typeof item.word).toBe('string');
			expect(typeof item.reading).toBe('string');
			expect(typeof item.meaning).toBe('string');
			expect(typeof item.formLabel).toBe('string');
			expect(item.targetMeaning).toBe('test gloss');
			expect(item.cellId).toBe(`${item.wordClass}:${item.formId}`);
		}
		expect(mocks.verifyUserExists).toHaveBeenCalledWith(expect.anything(), 2);
		expect(mocks.evaluate).toHaveBeenCalledWith(
			expect.objectContaining({ mode: 'conjugation_prompt_glosses' })
		);
		expect(callOrder).toEqual(['verify', 'fetch', 'start', 'glosses']);
	});

	it('rejects with 429 once the per-IP rate limit is exceeded', async () => {
		mocks.verifyUserExists.mockImplementation(async () => {});
		mocks.fetchConjugationContext.mockImplementation(async () => ({
			cellStates: [],
			sessionIndex: 0
		}));
		mocks.startSession.mockImplementation(async () => 1);
		mocks.evaluate.mockImplementation(async (req: { items: { cellId: string }[] }) => ({
			glosses: req.items.map((i) => ({ cellId: i.cellId, targetMeaning: 'test gloss' }))
		}));

		const ip = `198.51.100.${Math.floor(Math.random() * 255)}`;
		for (let i = 0; i < 20; i++) {
			await POST(makeEvent({ userId: 1 }, { authHeader: 'Bearer correct-secret', ip }));
		}
		try {
			await POST(makeEvent({ userId: 1 }, { authHeader: 'Bearer correct-secret', ip }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 429)).toBe(true);
		}
	});
});
