import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/supabase', () => ({
	createServiceClient: vi.fn(() => ({}))
}));

const mocks = vi.hoisted(() => ({
	verifyUserExists: vi.fn(),
	fetchChunkLibrary: vi.fn(),
	fetchShadowingChunkStates: vi.fn(),
	getLatestSessionIndex: vi.fn(),
	fetchChunkDetailsWithSignedUrls: vi.fn(),
	insertSessionRow: vi.fn()
}));

vi.mock('$lib/server/conjugation-auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/conjugation-auth')>();
	return { ...actual, verifyUserExists: mocks.verifyUserExists };
});

// SessionAlreadyStartingError kept real (not mocked) — +server.ts's catch
// block does an `instanceof` check against it, so a test double class
// wouldn't satisfy that check.
vi.mock('$lib/server/shadowing-repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/shadowing-repository')>();
	return {
		...actual,
		fetchChunkLibrary: mocks.fetchChunkLibrary,
		fetchShadowingChunkStates: mocks.fetchShadowingChunkStates,
		getLatestSessionIndex: mocks.getLatestSessionIndex,
		fetchChunkDetailsWithSignedUrls: mocks.fetchChunkDetailsWithSignedUrls,
		insertSessionRow: mocks.insertSessionRow
	};
});

import { POST } from './+server';
import { UserNotFoundError } from '$lib/server/conjugation-auth';
import { SessionAlreadyStartingError } from '$lib/server/shadowing-repository';

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
		mocks.getLatestSessionIndex.mockResolvedValueOnce(0);

		const response = await POST(makeEvent({ userId: 1 }));
		const body = await response.json();

		expect(body.drillItems).toEqual([]);
		expect(mocks.insertSessionRow).not.toHaveBeenCalled();
		expect(mocks.fetchChunkDetailsWithSignedUrls).not.toHaveBeenCalled();
		// Restricted to library membership (see fetchShadowingChunkStates'
		// doc comment) — with an empty library there's nothing to restrict
		// to, so it should never even be called.
		expect(mocks.fetchShadowingChunkStates).not.toHaveBeenCalled();
	});

	it('fetches chunk states restricted to the library it just fetched, not fetched in parallel and filtered afterward — regression: an unfiltered fetch transferred (and paginated past 1000 rows for) shadowing_state history that re-chunking/flagging leave permanently orphaned, growing unboundedly since only current library chunk_ids can ever be selected', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce(fakeLibrary(2)); // rec:1:00, rec:1:01
		mocks.getLatestSessionIndex.mockResolvedValueOnce(1);
		mocks.fetchShadowingChunkStates.mockResolvedValueOnce([]);
		mocks.fetchChunkDetailsWithSignedUrls.mockImplementationOnce(
			async (_s, _u, chunkIds: string[]) => fakeDetails(chunkIds)
		);

		await POST(makeEvent({ userId: 1 }));

		expect(mocks.fetchShadowingChunkStates).toHaveBeenCalledWith(expect.anything(), 1, [
			'rec:1:00',
			'rec:1:01'
		]);
	});

	it('verifies the user, selects drill items from the library, and returns them with signed URLs', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce(fakeLibrary(15));
		mocks.getLatestSessionIndex.mockResolvedValueOnce(0);
		mocks.fetchShadowingChunkStates.mockResolvedValueOnce([]);
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
		expect(mocks.insertSessionRow).toHaveBeenCalledWith(expect.anything(), 2, 1);
	});

	it('returns existing box/box4Streak for a due (non-new) chunk', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce(fakeLibrary(1));
		mocks.getLatestSessionIndex.mockResolvedValueOnce(1);
		mocks.fetchShadowingChunkStates.mockResolvedValueOnce([
			{ word: 'rec:1:00', box: 2, lastSession: 0, box4Streak: 0 }
		]);
		mocks.fetchChunkDetailsWithSignedUrls.mockImplementationOnce(
			async (_s, _u, chunkIds: string[]) => fakeDetails(chunkIds)
		);

		const response = await POST(makeEvent({ userId: 1 }));
		const body = await response.json();

		expect(body.drillItems).toHaveLength(1);
		expect(body.drillItems[0].isNew).toBe(false);
		expect(body.drillItems[0].box).toBe(2);
	});

	it('throws if a selected chunk has no matching detail row, and never inserts a session row — regression: the session row used to be inserted before this step, leaving an orphaned incomplete session behind on any failure here (Storage signing, a missing detail row) instead of just failing cleanly', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce(fakeLibrary(1));
		mocks.getLatestSessionIndex.mockResolvedValueOnce(0);
		mocks.fetchShadowingChunkStates.mockResolvedValueOnce([]);
		mocks.fetchChunkDetailsWithSignedUrls.mockResolvedValueOnce([]);

		await expect(POST(makeEvent({ userId: 1 }))).rejects.toThrow(/No chunk detail found/);
		expect(mocks.insertSessionRow).not.toHaveBeenCalled();
	});

	it("rejects with a clean 409 on a session_index collision, without retrying into a second concurrent session — regression: retrying with a freshly re-read session_index used to build and return a second, fully valid, concurrently-active session from the same stale progress snapshot passed into this request; if that second session completed before this one, this session's later completion would unconditionally overwrite newer box/last_session data with older values", async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce(fakeLibrary(1));
		mocks.getLatestSessionIndex.mockResolvedValueOnce(0);
		mocks.fetchShadowingChunkStates.mockResolvedValueOnce([]);
		mocks.fetchChunkDetailsWithSignedUrls.mockImplementationOnce(
			async (_s, _u, chunkIds: string[]) => fakeDetails(chunkIds)
		);
		mocks.insertSessionRow.mockRejectedValueOnce(new SessionAlreadyStartingError());

		try {
			await POST(makeEvent({ userId: 1 }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 409)).toBe(true);
		}
		expect(mocks.insertSessionRow).toHaveBeenCalledTimes(1);
	});

	it('does not convert a non-conflict error from insertSessionRow into a 409', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce(fakeLibrary(1));
		mocks.getLatestSessionIndex.mockResolvedValueOnce(0);
		mocks.fetchShadowingChunkStates.mockResolvedValueOnce([]);
		mocks.fetchChunkDetailsWithSignedUrls.mockImplementationOnce(
			async (_s, _u, chunkIds: string[]) => fakeDetails(chunkIds)
		);
		mocks.insertSessionRow.mockRejectedValueOnce(new Error('network blip'));

		await expect(POST(makeEvent({ userId: 1 }))).rejects.toThrow('network blip');
		expect(mocks.insertSessionRow).toHaveBeenCalledTimes(1);
	});

	it('rejects with 429 once the per-IP rate limit is exceeded', async () => {
		mocks.verifyUserExists.mockResolvedValue(undefined);
		mocks.fetchChunkLibrary.mockResolvedValue(fakeLibrary(1));
		mocks.getLatestSessionIndex.mockResolvedValue(0);
		mocks.fetchShadowingChunkStates.mockResolvedValue([]);
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
