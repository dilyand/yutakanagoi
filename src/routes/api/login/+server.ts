import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { z } from 'zod';
import { dev } from '$app/environment';
import { createServiceClient } from '$lib/server/supabase';
import { findUserByUsername } from '$lib/server/user-list-repository';
import { verifyPassword } from '$lib/server/password';
import { createSession, SESSION_COOKIE_NAME } from '$lib/server/session';
import { checkRateLimit } from '$lib/server/rate-limit';

const RequestSchema = z.object({
	username: z.string().min(1).max(50),
	password: z.string().min(1).max(200)
});

// Bounds both a scripted guessing attack against one IP and a distributed
// one against one account — same 10/5min shape the old passphrase gate's
// verify-secret endpoint used.
const LIMIT = 10;
const WINDOW_MS = 5 * 60 * 1000;

// Every failure returns the same generic message/status, whether the
// username doesn't exist, has no password set yet, or the password is
// wrong — so a caller can't enumerate valid usernames from this endpoint.
export const POST: RequestHandler = async ({ request, cookies, getClientAddress }) => {
	const parsedBody = RequestSchema.safeParse(await request.json());
	if (!parsedBody.success) {
		error(400, 'Invalid request body');
	}
	const { username, password } = parsedBody.data;

	const ip = getClientAddress();
	if (
		!checkRateLimit(`login:ip:${ip}`, LIMIT, WINDOW_MS) ||
		!checkRateLimit(`login:username:${username}`, LIMIT, WINDOW_MS)
	) {
		error(429, 'Too many attempts — please wait and try again.');
	}

	const supabase = createServiceClient();
	const user = await findUserByUsername(supabase, username);
	if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
		error(401, 'Invalid username or password.');
	}

	const { token, expiresAt } = await createSession(supabase, user.id);
	cookies.set(SESSION_COOKIE_NAME, token, {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax',
		expires: expiresAt
	});

	return json({ userId: user.id, username: user.username });
};
