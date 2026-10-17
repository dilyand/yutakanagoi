import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/supabase', () => ({ createServiceClient: vi.fn(() => ({})) }));

const mocks = vi.hoisted(() => ({ verifyUserExists: vi.fn(), listRecentTargets: vi.fn() }));

vi.mock('$lib/server/conjugation-auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/conjugation-auth')>();
	return { ...actual, verifyUserExists: mocks.verifyUserExists };
});
vi.mock('$lib/server/target-practice/history-repository', () => ({
	listRecentTargets: mocks.listRecentTargets
}));

import { GET } from './+server';
import { UserNotFoundError } from '$lib/server/conjugation-auth';

function makeEvent({
	userId = 1,
	ip = '203.0.113.1'
}: { userId?: number | null; ip?: string } = {}) {
	return {
		getClientAddress: () => ip,
		locals: { userId: userId ?? undefined }
	} as unknown as Parameters<typeof GET>[0];
}

afterEach(() => vi.clearAllMocks());

describe('GET /api/target/history', () => {
	it('rejects with 401 when unauthenticated', async () => {
		await expect(GET(makeEvent({ userId: null }))).rejects.toSatisfy((e) => isHttpError(e, 401));
	});

	it('rejects with 403 when the user does not exist', async () => {
		mocks.verifyUserExists.mockRejectedValueOnce(new UserNotFoundError());
		await expect(GET(makeEvent())).rejects.toSatisfy((e) => isHttpError(e, 403));
	});

	it("lists the session user's recents", async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.listRecentTargets.mockResolvedValueOnce([{ type: 'word', targetKey: 'a' }]);

		const response = await GET(makeEvent({ userId: 7 }));

		expect(await response.json()).toEqual({ recents: [{ type: 'word', targetKey: 'a' }] });
		expect(mocks.listRecentTargets).toHaveBeenCalledWith(expect.anything(), 7);
	});

	it('rejects with 429 once the per-IP rate limit is exceeded', async () => {
		mocks.verifyUserExists.mockResolvedValue(undefined);
		mocks.listRecentTargets.mockResolvedValue([]);
		const ip = `198.51.100.${Math.floor(Math.random() * 255)}`;
		for (let i = 0; i < 60; i++) await GET(makeEvent({ ip }));
		await expect(GET(makeEvent({ ip }))).rejects.toSatisfy((e) => isHttpError(e, 429));
	});
});
