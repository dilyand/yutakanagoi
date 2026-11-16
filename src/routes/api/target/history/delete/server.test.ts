import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/supabase', () => ({ createServiceClient: vi.fn(() => ({})) }));

const mocks = vi.hoisted(() => ({ verifyUserExists: vi.fn(), deleteRecentTarget: vi.fn() }));

vi.mock('$lib/server/conjugation-auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/conjugation-auth')>();
	return { ...actual, verifyUserExists: mocks.verifyUserExists };
});
vi.mock('$lib/server/target-practice/history-repository', () => ({
	deleteRecentTarget: mocks.deleteRecentTarget
}));

import { POST } from './+server';
import { UserNotFoundError } from '$lib/server/conjugation-auth';

function makeEvent({
	userId = 1,
	ip = '203.0.113.1',
	body = { type: 'grammar', targetKey: '〜かどうか' }
}: { userId?: number | null; ip?: string; body?: unknown } = {}) {
	return {
		request: { json: async () => body },
		getClientAddress: () => ip,
		locals: { userId: userId ?? undefined }
	} as unknown as Parameters<typeof POST>[0];
}

afterEach(() => vi.clearAllMocks());

describe('POST /api/target/history/delete', () => {
	it('rejects with 401 when unauthenticated', async () => {
		await expect(POST(makeEvent({ userId: null }))).rejects.toSatisfy((e) => isHttpError(e, 401));
	});

	it('rejects a malformed body with 400', async () => {
		for (const body of [
			{ type: 'grammar' },
			{ type: 'haiku', targetKey: 'x' },
			{ type: 'word', targetKey: '' }
		]) {
			await expect(POST(makeEvent({ body }))).rejects.toSatisfy((e) => isHttpError(e, 400));
		}
	});

	it('rejects with 403 when the user does not exist', async () => {
		mocks.verifyUserExists.mockRejectedValueOnce(new UserNotFoundError());
		await expect(POST(makeEvent())).rejects.toSatisfy((e) => isHttpError(e, 403));
	});

	it('deletes scoped to the session-derived user', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.deleteRecentTarget.mockResolvedValueOnce(undefined);

		const response = await POST(makeEvent({ userId: 7 }));

		expect(await response.json()).toEqual({ ok: true });
		expect(mocks.deleteRecentTarget).toHaveBeenCalledWith(
			expect.anything(),
			7,
			'grammar',
			'〜かどうか'
		);
	});

	it('rejects with 429 once the per-IP rate limit is exceeded', async () => {
		mocks.verifyUserExists.mockResolvedValue(undefined);
		mocks.deleteRecentTarget.mockResolvedValue(undefined);
		const ip = `198.51.100.${Math.floor(Math.random() * 255)}`;
		for (let i = 0; i < 30; i++) await POST(makeEvent({ ip }));
		await expect(POST(makeEvent({ ip }))).rejects.toSatisfy((e) => isHttpError(e, 429));
	});
});
