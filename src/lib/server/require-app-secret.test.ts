import { describe, expect, it, afterEach, vi } from 'vitest';
import { isHttpError } from '@sveltejs/kit';

const mockEnv = vi.hoisted(() => ({ APP_SHARED_SECRET: 'correct-secret' as string | undefined }));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

import { requireAppSecret } from './require-app-secret';

function requestWith(authHeader?: string): Request {
	return new Request('http://localhost/api/test', {
		headers: authHeader ? { Authorization: authHeader } : {}
	});
}

describe('requireAppSecret', () => {
	afterEach(() => {
		mockEnv.APP_SHARED_SECRET = 'correct-secret';
	});

	it('does not throw when the Bearer token matches APP_SHARED_SECRET', () => {
		expect(() => requireAppSecret(requestWith('Bearer correct-secret'))).not.toThrow();
	});

	it('throws 401 when the Authorization header is missing', () => {
		try {
			requireAppSecret(requestWith());
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 401)).toBe(true);
		}
	});

	it('throws 401 when the header is not a Bearer token', () => {
		try {
			requireAppSecret(requestWith('Basic correct-secret'));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 401)).toBe(true);
		}
	});

	it('throws 401 when the Bearer token does not match', () => {
		try {
			requireAppSecret(requestWith('Bearer wrong-secret'));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 401)).toBe(true);
		}
	});

	it('throws 500 when APP_SHARED_SECRET is not configured', () => {
		mockEnv.APP_SHARED_SECRET = undefined;
		try {
			requireAppSecret(requestWith('Bearer anything'));
			expect.unreachable();
		} catch (e) {
			expect(isHttpError(e, 500)).toBe(true);
		}
	});
});
