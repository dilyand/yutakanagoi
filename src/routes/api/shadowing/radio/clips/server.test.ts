import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/supabase', () => ({
	createServiceClient: vi.fn(() => ({}))
}));

const mocks = vi.hoisted(() => ({
	verifyUserExists: vi.fn(),
	fetchChunkDetailsWithSignedUrls: vi.fn(),
	insertSessionRow: vi.fn(),
	completeSession: vi.fn(),
	upsertChunkStates: vi.fn(),
	insertSessionAttempts: vi.fn(),
	flagChunk: vi.fn()
}));

vi.mock('$lib/server/conjugation-auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/conjugation-auth')>();
	return { ...actual, verifyUserExists: mocks.verifyUserExists };
});

vi.mock('$lib/server/shadowing-repository', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/shadowing-repository')>();
	return {
		...actual,
		fetchChunkDetailsWithSignedUrls: mocks.fetchChunkDetailsWithSignedUrls,
		insertSessionRow: mocks.insertSessionRow,
		completeSession: mocks.completeSession,
		upsertChunkStates: mocks.upsertChunkStates,
		insertSessionAttempts: mocks.insertSessionAttempts,
		flagChunk: mocks.flagChunk
	};
});

import { POST } from './+server';
import { UserNotFoundError } from '$lib/server/conjugation-auth';

// `userId: null` means unauthenticated. Not `undefined`: a destructuring
// default would silently turn an explicit `undefined` back into 1.
function makeEvent({
	userId = 1,
	ip = '203.0.113.1',
	body = { chunkIds: ['rec:1:00'] },
	rawJsonThrows = false
}: { userId?: number | null; ip?: string; body?: unknown; rawJsonThrows?: boolean } = {}) {
	return {
		request: {
			json: async () => {
				if (rawJsonThrows) throw new SyntaxError('Unexpected token');
				return body;
			}
		},
		getClientAddress: () => ip,
		locals: { userId: userId ?? undefined }
	} as unknown as Parameters<typeof POST>[0];
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

// Takes `unknown` because a SvelteKit handler's declared return type is
// MaybePromise<Response>; awaiting a plain value is harmless.
async function expectStatus(promise: unknown, status: number) {
	try {
		await promise;
		expect.unreachable();
	} catch (e) {
		expect(isHttpError(e, status), `expected HTTP ${status}, got ${String(e)}`).toBe(true);
	}
}

describe('POST /api/shadowing/radio/clips', () => {
	afterEach(() => {
		vi.resetAllMocks();
	});

	it('rejects with 401 and does nothing else when unauthenticated', async () => {
		await expectStatus(POST(makeEvent({ userId: null })), 401);
		expect(mocks.verifyUserExists).not.toHaveBeenCalled();
		expect(mocks.fetchChunkDetailsWithSignedUrls).not.toHaveBeenCalled();
	});

	it('rejects with 403 when the user does not exist, and mints no URLs', async () => {
		mocks.verifyUserExists.mockRejectedValueOnce(new UserNotFoundError());
		await expectStatus(POST(makeEvent()), 403);
		expect(mocks.fetchChunkDetailsWithSignedUrls).not.toHaveBeenCalled();
	});

	it.each([
		['a body that is not JSON', { rawJsonThrows: true }],
		['no chunkIds', { body: {} }],
		['an empty chunkIds array', { body: { chunkIds: [] } }],
		['more than 5 chunkIds', { body: { chunkIds: ['a', 'b', 'c', 'd', 'e', 'f'] } }],
		['chunkIds that is not an array', { body: { chunkIds: 'rec:1:00' } }],
		['a non-string chunk id', { body: { chunkIds: [42] } }],
		['an over-long chunk id', { body: { chunkIds: ['x'.repeat(201)] } }]
	])('rejects with 400 on %s, without verifying the user or minting URLs', async (_name, event) => {
		await expectStatus(POST(makeEvent(event)), 400);
		expect(mocks.verifyUserExists).not.toHaveBeenCalled();
		expect(mocks.fetchChunkDetailsWithSignedUrls).not.toHaveBeenCalled();
	});

	it('accepts exactly 5 ids and returns clips in the order the repository gives', async () => {
		const ids = ['c0', 'c1', 'c2', 'c3', 'c4'];
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkDetailsWithSignedUrls.mockResolvedValueOnce(fakeDetails(ids));

		const body = await (await POST(makeEvent({ body: { chunkIds: ids } }))).json();

		expect(body.clips.map((c: { chunkId: string }) => c.chunkId)).toEqual(ids);
		expect(body.clips[0]).toEqual({
			chunkId: 'c0',
			audioUrl: 'https://example.test/c0.m4a',
			transcript: 'transcript',
			kana: 'かな',
			translation: 'translation',
			durationMs: 5000
		});
	});

	it('scopes the lookup to the session user, never anything client-supplied', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkDetailsWithSignedUrls.mockResolvedValueOnce([]);

		await POST(makeEvent({ userId: 42, body: { chunkIds: ['rec:1:00'], userId: 999 } }));

		expect(mocks.verifyUserExists).toHaveBeenCalledWith(expect.anything(), 42);
		expect(mocks.fetchChunkDetailsWithSignedUrls).toHaveBeenCalledWith(expect.anything(), 42, [
			'rec:1:00'
		]);
	});

	it('dedupes repeated ids (keeping first-seen order) before looking them up', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		mocks.fetchChunkDetailsWithSignedUrls.mockResolvedValueOnce([]);

		await POST(makeEvent({ body: { chunkIds: ['b', 'a', 'b', 'a', 'c'] } }));

		expect(mocks.fetchChunkDetailsWithSignedUrls).toHaveBeenCalledWith(expect.anything(), 1, [
			'b',
			'a',
			'c'
		]);
	});

	it('simply omits ids that are unknown, flagged or another user’s — 200, not an error', async () => {
		mocks.verifyUserExists.mockResolvedValueOnce(undefined);
		// The repository returns only the rows it matched for this user.
		mocks.fetchChunkDetailsWithSignedUrls.mockResolvedValueOnce(fakeDetails(['mine']));

		const response = await POST(makeEvent({ body: { chunkIds: ['mine', 'theirs', 'nope'] } }));

		expect(response.status).toBe(200);
		expect((await response.json()).clips.map((c: { chunkId: string }) => c.chunkId)).toEqual([
			'mine'
		]);
	});

	it('never writes anything', async () => {
		mocks.verifyUserExists.mockResolvedValue(undefined);
		mocks.fetchChunkDetailsWithSignedUrls.mockResolvedValue(fakeDetails(['rec:1:00']));

		await POST(makeEvent());

		for (const name of [
			'insertSessionRow',
			'completeSession',
			'upsertChunkStates',
			'insertSessionAttempts',
			'flagChunk'
		] as const) {
			expect(mocks[name], name).not.toHaveBeenCalled();
		}
	});

	it('rejects with 429 once the per-IP rate limit is exceeded', async () => {
		mocks.verifyUserExists.mockResolvedValue(undefined);
		mocks.fetchChunkDetailsWithSignedUrls.mockResolvedValue([]);

		const ip = `198.51.100.${Math.floor(Math.random() * 255)}`;
		for (let i = 0; i < 120; i++) {
			await POST(makeEvent({ ip }));
		}
		await expectStatus(POST(makeEvent({ ip })), 429);
	});
});
