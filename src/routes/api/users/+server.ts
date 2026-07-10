import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createServiceClient } from '$lib/server/supabase';
import { listUsers } from '$lib/server/user-list-repository';
import { checkRateLimit } from '$lib/server/rate-limit';

// Intentionally pre-auth — the login form needs this to populate its
// username dropdown before a session exists. Only ever returns id/username
// (listUsers never selects password_hash), same exposure as a login page's
// "choose your account" step. Rate-limited since it's reachable without a
// session.
const LIMIT = 30;
const WINDOW_MS = 5 * 60 * 1000;

// Users are created out-of-band via scripts/add-user.ts, never through the app —
// this just lists them for the username dropdown.
export const GET: RequestHandler = async ({ getClientAddress }) => {
	if (!checkRateLimit(`users:${getClientAddress()}`, LIMIT, WINDOW_MS)) {
		error(429, 'Too many requests — please wait and try again.');
	}

	const supabase = createServiceClient();
	const users = await listUsers(supabase);

	return json({ users });
};
