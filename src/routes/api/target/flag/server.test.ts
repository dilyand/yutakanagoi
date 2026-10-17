import { describe, expect, it, vi, afterEach } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

vi.mock('$lib/server/supabase', () => ({ createServiceClient: vi.fn(() => ({})) }));

const mocks = vi.hoisted(() => ({ verifyUserExists: vi.fn(), insertFlag: vi.fn() }));

vi.mock('$lib/server/conjugation-auth', async (importOriginal) => {
	const actual = await importOriginal<typeof import('$lib/server/conjugation-auth')>();
	return { ...actual, verifyUserExists: mocks.verifyUserExists };
});
vi.mock('$lib/server/target-practice/flags-repository', () => ({ insertFlag: mocks.insertFlag }));

import { POST } from './+server';
import { UserNotFoundError } from '$lib/server/conjugation-auth';

const valid = {
	type: 'grammar',
	targetKey: '〜かどうか',
	phase: 'understand',
	item: { id: 'g-u1', kind: 'mc' },
	reason: 'answer_wrong',
	note: 'Two options work.'
};

let nextIp = 0;
function makeEvent({
	userId = 1,
	ip = `192.0.2.${(nextIp++ % 250) + 1}`,
	body = valid
}: { userId?: number | null; ip?: string; body?: unknown } = {}) {
	return {
		request: { json: async () => body },
		getClientAddress: () => ip,
		locals: { userId: userId ?? undefined }
	} as unknown as Parameters<typeof POST>[0];
}

async function status(promise: unknown): Promise<number> {
	try {
		await promise;
	} catch (e) {
		for (const s of [400, 401, 403, 429]) if (isHttpError(e, s)) return s;
		throw e;
	}
	return 200;
}

afterEach(() => vi.clearAllMocks());

describe('POST /api/target/flag', () => {
	it('rejects with 401 when unauthenticated', async () => {
		expect(await status(POST(makeEvent({ userId: null })))).toBe(401);
		expect(mocks.insertFlag).not.toHaveBeenCalled();
	});

	it('rejects a malformed body with 400', async () => {
		for (const body of [
			{ ...valid, type: 'haiku' },
			{ ...valid, targetKey: '' },
			{ ...valid, phase: 'bogus' },
			{ ...valid, reason: 'because' },
			{ ...valid, note: 'x'.repeat(501) },
			{ ...valid, item: { big: 'x'.repeat(7000) } }
		]) {
			expect(await status(POST(makeEvent({ body })))).toBe(400);
		}
		expect(mocks.insertFlag).not.toHaveBeenCalled();
	});

	it('rejects with 403 when the user does not exist', async () => {
		mocks.verifyUserExists.mockRejectedValueOnce(new UserNotFoundError());
		expect(await status(POST(makeEvent()))).toBe(403);
	});

	it('stores an item flag and a card flag for the session user', async () => {
		mocks.verifyUserExists.mockResolvedValue(undefined);
		mocks.insertFlag.mockResolvedValue(undefined);
		const response = await POST(makeEvent({ userId: 7 }));
		expect(await response.json()).toEqual({ ok: true });
		expect(mocks.insertFlag).toHaveBeenCalledWith(expect.anything(), 7, valid);

		const card = { type: 'word', targetKey: '厳しい|きびしい', reason: 'card_wrong' };
		expect(await status(POST(makeEvent({ userId: 7, body: card })))).toBe(200);
		expect(mocks.insertFlag).toHaveBeenLastCalledWith(expect.anything(), 7, card);
	});
});
