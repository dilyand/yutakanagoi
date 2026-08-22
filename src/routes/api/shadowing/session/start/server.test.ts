import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/supabase', () => ({
	createServiceClient: vi.fn(() => ({}))
}));

const mocks = vi.hoisted(() => ({
	verifyUserExists: vi.fn(),
	fetchChunkLibrary: vi.fn(),
	fetchShadowingContext: vi.fn(),
	fetchChunkDetailsWithSignedUrls: vi.fn(),
	startSession: vi.fn()
}));

vi.mock('$lib/server/conjugation-auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/conjugation-auth')>();
	return { ...actual, verifyUserExists: mocks.verifyUserExists };
});

vi.mock('$lib/server/shadowing-repository', () => ({
	fetchChunkLibrary: mocks.fetchChunkLibrary,
	fetchShadowingContext: mocks.fetchShadowingContext,
	fetchChunkDetailsWithSignedUrls: mocks.fetchChunkDetailsWithSignedUrls,
	startSession: mocks.startSession
}));

import { POST } from './+server';
import { UserNotFoundError } from '$lib/server/conjugation-auth';

function makeEvent(
	{ userId, ip = '203.0.113.1' }: { userId?: number; ip?: string } = { userId: 1 }
) {
	return { getClientAddress: () => ip, locals: { userId } } as unknown as Parameters<
		typeof POST
	>[0];
}

function fakeLibrary(n: number) {
	return Array.from({ length: n }, (_, i) => ({
		chunkId: `rec:1:${String(i).padStart(2, '0')}`,
		frequencyRank: i
	}));
}

function fakeDetails(chunkIds: string[]) {
	return chunkIds.map((chunkId) => ({
		chunkId,
		audioUrl: `https://example.test/${chunkId}.m4a`,
		transcript: 'transcript',
		kana: 'かな',
		translation: 'translation',
		durationMs: 5000
	}));
}

describe('POST /api/shadowing/session/start', () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it('rejects with 401 and never calls verifyUserExists when unauthenticated', async () => {
		try {
			await POST(makeEvent({ userId: undefined }));
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

	it('returns an empty session without creating a shadowing_sessions row when the library is empty — regression: startSession used to run unconditionally, leaving an orphaned incomplete session on every attempt before a user had any content', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce([]);
		mocks.fetchShadowingContext.mockResolvedValueOnce({ chunkStates: [], sessionIndex: 0 });

		const response = await POST(makeEvent({ userId: 1 }));
		const body = await response.json();

		expect(body.drillItems).toEqual([]);
		expect(mocks.startSession).not.toHaveBeenCalled();
		expect(mocks.fetchChunkDetailsWithSignedUrls).not.toHaveBeenCalled();
	});

	it('verifies the user, selects drill items from the library, and returns them with signed URLs', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce(fakeLibrary(15));
		mocks.fetchShadowingContext.mockResolvedValueOnce({ chunkStates: [], sessionIndex: 0 });
		mocks.startSession.mockResolvedValueOnce(1);
		mocks.fetchChunkDetailsWithSignedUrls.mockImplementationOnce(
			async (_s, _u, chunkIds: string[]) => fakeDetails(chunkIds)
		);

		const response = await POST(makeEvent({ userId: 2 }));
		const body = await response.json();

		expect(body.sessionIndex).toBe(1);
		expect(body.drillItems).toHaveLength(10);
		for (const item of body.drillItems) {
			expect(item.isNew).toBe(true);
			expect(item.box).toBeUndefined();
			expect(item.box4Streak).toBeUndefined();
			expect(typeof item.chunkId).toBe('string');
			expect(item.audioUrl).toContain(item.chunkId);
			expect(item.transcript).toBe('transcript');
			expect(item.kana).toBe('かな');
			expect(item.translation).toBe('translation');
		}
		expect(mocks.verifyUserExists).toHaveBeenCalledWith(expect.anything(), 2);
	});

	it('returns existing box/box4Streak for a due (non-new) chunk', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce(fakeLibrary(1));
		mocks.fetchShadowingContext.mockResolvedValueOnce({
			chunkStates: [{ word: 'rec:1:00', box: 2, lastSession: 0, box4Streak: 0 }],
			sessionIndex: 1
		});
		mocks.startSession.mockResolvedValueOnce(2);
		mocks.fetchChunkDetailsWithSignedUrls.mockImplementationOnce(
			async (_s, _u, chunkIds: string[]) => fakeDetails(chunkIds)
		);

		const response = await POST(makeEvent({ userId: 1 }));
		const body = await response.json();

		expect(body.drillItems).toHaveLength(1);
		expect(body.drillItems[0].isNew).toBe(false);
		expect(body.drillItems[0].box).toBe(2);
	});

	it('never selects a chunk whose progress row survives after it left the library (e.g. was flagged) — regression for a real bug found in manual testing', async () => {
		// Flagging a chunk removes it from fetchChunkLibrary's result
		// without touching its shadowing_state row. selectDrillWords's
		// due-review and not-yet-due-fallback paths pull straight from the
		// progress list with no cross-check against the master list — so
		// an unfiltered chunkStates lets a flagged chunk's old progress
		// resurface via those fallback paths even though it's no longer in
		// the library. This reproduced 100% of the time against the real
		// local Supabase stack until the endpoint started filtering
		// chunkStates down to library membership before calling
		// selectDrillWords.
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce(fakeLibrary(2)); // rec:1:00, rec:1:01
		mocks.fetchShadowingContext.mockResolvedValueOnce({
			chunkStates: [
				{ word: 'rec:1:00', box: 4, lastSession: 1, box4Streak: 0 },
				{ word: 'rec:1:01', box: 4, lastSession: 1, box4Streak: 0 },
				// Not in the library above — simulates a flagged chunk that
				// still has progress history.
				{ word: 'rec:1:99-flagged', box: 4, lastSession: 1, box4Streak: 0 }
			],
			sessionIndex: 1
		});
		mocks.startSession.mockResolvedValueOnce(2);
		mocks.fetchChunkDetailsWithSignedUrls.mockImplementationOnce(
			async (_s, _u, chunkIds: string[]) => fakeDetails(chunkIds)
		);

		const response = await POST(makeEvent({ userId: 1 }));
		const body = await response.json();

		const chunkIds = body.drillItems.map((item: { chunkId: string }) => item.chunkId);
		expect(chunkIds).not.toContain('rec:1:99-flagged');
		expect(chunkIds.every((id: string) => ['rec:1:00', 'rec:1:01'].includes(id))).toBe(true);
	});

	it('throws if a selected chunk has no matching detail row (should be unreachable in practice)', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce(fakeLibrary(1));
		mocks.fetchShadowingContext.mockResolvedValueOnce({ chunkStates: [], sessionIndex: 0 });
		mocks.startSession.mockResolvedValueOnce(1);
		mocks.fetchChunkDetailsWithSignedUrls.mockResolvedValueOnce([]);

		await expect(POST(makeEvent({ userId: 1 }))).rejects.toThrow(/No chunk detail found/);
	});

	it('rejects with 429 once the per-IP rate limit is exceeded', async () => {
		mocks.verifyUserExists.mockResolvedValue(undefined);
		mocks.fetchChunkLibrary.mockResolvedValue(fakeLibrary(1));
		mocks.fetchShadowingContext.mockResolvedValue({ chunkStates: [], sessionIndex: 0 });
		mocks.startSession.mockResolvedValue(1);
		mocks.fetchChunkDetailsWithSignedUrls.mockImplementation(async (_s, _u, chunkIds: string[]) =>
			fakeDetails(chunkIds)
		);

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
