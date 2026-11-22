import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/supabase', () => ({
	createServiceClient: vi.fn(() => ({}))
}));

// Every shadowing-repository WRITE export (and the signed-URL-minting one)
// is mocked, not just the functions this route uses, so the "never writes"
// test below can assert on them by name — if the route ever started
// importing one, it'd be a mock here rather than a real DB call, and the
// assertion would catch it.
const mocks = vi.hoisted(() => ({
	verifyUserExists: vi.fn(),
	fetchChunkLibrary: vi.fn(),
	fetchShadowingChunkStates: vi.fn(),
	getLatestSessionIndex: vi.fn(),
	insertSessionRow: vi.fn(),
	completeSession: vi.fn(),
	upsertChunkStates: vi.fn(),
	insertSessionAttempts: vi.fn(),
	flagChunk: vi.fn(),
	fetchChunkDetailsWithSignedUrls: vi.fn()
}));

vi.mock('$lib/server/conjugation-auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/conjugation-auth')>();
	return { ...actual, verifyUserExists: mocks.verifyUserExists };
});

vi.mock('$lib/server/shadowing-repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/shadowing-repository')>();
	return {
		...actual,
		fetchChunkLibrary: mocks.fetchChunkLibrary,
		fetchShadowingChunkStates: mocks.fetchShadowingChunkStates,
		getLatestSessionIndex: mocks.getLatestSessionIndex,
		insertSessionRow: mocks.insertSessionRow,
		completeSession: mocks.completeSession,
		upsertChunkStates: mocks.upsertChunkStates,
		insertSessionAttempts: mocks.insertSessionAttempts,
		flagChunk: mocks.flagChunk,
		fetchChunkDetailsWithSignedUrls: mocks.fetchChunkDetailsWithSignedUrls
	};
});

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

const WRITE_FUNCTIONS = [
	'insertSessionRow',
	'completeSession',
	'upsertChunkStates',
	'insertSessionAttempts',
	'flagChunk'
] as const;

describe('POST /api/shadowing/radio/playlist', () => {
	afterEach(() => {
		vi.resetAllMocks();
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

	it('rejects with 403 when the user does not exist, and fetches nothing', async () => {
		mocks.verifyUserExists.mockRejectedValueOnce(new UserNotFoundError());
		try {
			await POST(makeEvent({ userId: 1 }));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 403)).toBe(true);
		}
		expect(mocks.fetchChunkLibrary).not.toHaveBeenCalled();
	});

	it('returns an empty playlist for an empty library without fetching chunk states', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce([]);
		mocks.getLatestSessionIndex.mockResolvedValueOnce(0);

		const response = await POST(makeEvent({ userId: 1 }));

		expect(await response.json()).toEqual({ chunkIds: [] });
		expect(mocks.fetchShadowingChunkStates).not.toHaveBeenCalled();
	});

	it('returns the whole library (not capped at 10), new chunks in introduction order', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce(fakeLibrary(25));
		mocks.getLatestSessionIndex.mockResolvedValueOnce(0);
		mocks.fetchShadowingChunkStates.mockResolvedValueOnce([]);

		const body = await (await POST(makeEvent({ userId: 1 }))).json();

		expect(body.chunkIds).toEqual(fakeLibrary(25).map((c) => c.chunkId));
	});

	it('orders due chunks before new chunks, using latest session index + 1 as "now"', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce(fakeLibrary(3));
		mocks.getLatestSessionIndex.mockResolvedValueOnce(4);
		// box 0 is due every session: last seen at 4, so due at session 5 (= latest + 1).
		mocks.fetchShadowingChunkStates.mockResolvedValueOnce([
			{ word: 'rec:1:02', box: 0, lastSession: 4, box4Streak: 0 }
		]);

		const body = await (await POST(makeEvent({ userId: 1 }))).json();

		expect(body.chunkIds).toEqual(['rec:1:02', 'rec:1:00', 'rec:1:01']);
	});

	it('uses exactly latest session index + 1 as "now" — not latest, not latest + 2', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce(fakeLibrary(3));
		mocks.getLatestSessionIndex.mockResolvedValueOnce(4);
		// box 1 is due every 2 sessions: last seen at 4, so due from session 6.
		// At "now" = 5 it's NOT due yet, so it sorts after the never-heard chunks;
		// a "now" of latest + 2 (6) would wrongly make it due and put it first.
		mocks.fetchShadowingChunkStates.mockResolvedValueOnce([
			{ word: 'rec:1:02', box: 1, lastSession: 4, box4Streak: 0 }
		]);

		const body = await (await POST(makeEvent({ userId: 1 }))).json();

		expect(body.chunkIds).toEqual(['rec:1:00', 'rec:1:01', 'rec:1:02']);
	});

	it('verifies and queries as the session user', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce([]);
		mocks.getLatestSessionIndex.mockResolvedValueOnce(0);

		await POST(makeEvent({ userId: 42 }));

		expect(mocks.verifyUserExists).toHaveBeenCalledWith(expect.anything(), 42);
		expect(mocks.fetchChunkLibrary).toHaveBeenCalledWith(expect.anything(), 42);
		expect(mocks.getLatestSessionIndex).toHaveBeenCalledWith(expect.anything(), 42);
	});

	it('fetches chunk states restricted to the library it just fetched', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkLibrary.mockResolvedValueOnce(fakeLibrary(2));
		mocks.getLatestSessionIndex.mockResolvedValueOnce(1);
		mocks.fetchShadowingChunkStates.mockResolvedValueOnce([]);

		await POST(makeEvent({ userId: 7 }));

		expect(mocks.fetchChunkLibrary).toHaveBeenCalledWith(expect.anything(), 7);
		expect(mocks.fetchShadowingChunkStates).toHaveBeenCalledWith(expect.anything(), 7, [
			'rec:1:00',
			'rec:1:01'
		]);
	});

	it('never writes — no session row, no progress, no attempts, no flag, and mints no signed URLs', async () => {
		mocks.verifyUserExists.mockResolvedValue(undefined);
		mocks.fetchChunkLibrary.mockResolvedValue(fakeLibrary(5));
		mocks.getLatestSessionIndex.mockResolvedValue(3);
		mocks.fetchShadowingChunkStates.mockResolvedValue([
			{ word: 'rec:1:01', box: 2, lastSession: 1, box4Streak: 0 }
		]);

		await POST(makeEvent({ userId: 1 }));

		for (const name of WRITE_FUNCTIONS) {
			expect(mocks[name], name).not.toHaveBeenCalled();
		}
		expect(mocks.fetchChunkDetailsWithSignedUrls).not.toHaveBeenCalled();
	});

	it('rejects with 429 once the per-IP rate limit is exceeded', async () => {
		mocks.verifyUserExists.mockResolvedValue(undefined);
		mocks.fetchChunkLibrary.mockResolvedValue(fakeLibrary(1));
		mocks.getLatestSessionIndex.mockResolvedValue(0);
		mocks.fetchShadowingChunkStates.mockResolvedValue([]);

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
