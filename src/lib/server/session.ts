import { createHash, randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { withRetry } from '$lib/server/retry';

// Fixed expiry, refreshed only on login (no sliding-refresh complexity for
// v1) — reasonable for a personal-use app logged into occasionally.
const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

// Shared by hooks.server.ts and the login/logout routes so the cookie name
// only needs to change in one place.
export const SESSION_COOKIE_NAME = 'session';

export interface Session {
	userId: number;
	username: string;
}

// Only this hash is ever stored — a read of the sessions table alone can't
// produce a replayable token, same spirit as password.ts's hashed storage.
function hashToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/**
 * Creates a session row and returns the raw token to set as a cookie. The
 * token itself is never persisted, only its hash.
 */
export async function createSession(
	supabase: SupabaseClient,
	userId: number
): Promise<{ token: string; expiresAt: Date }> {
	const token = randomBytes(32).toString('base64url');
	const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);

	const { error } = await withRetry(() =>
		supabase.from('sessions').insert({
			user_id: userId,
			token_hash: hashToken(token),
			expires_at: expiresAt.toISOString()
		})
	);
	if (error) throw error;

	return { token, expiresAt };
}

/**
 * Looks up an unexpired session for `token`, returning the user it belongs
 * to, or null if the token is missing/unknown/expired. Two plain queries
 * (session row, then user row) rather than a PostgREST embed, matching this
 * codebase's existing simple-select style elsewhere in this directory.
 */
export async function verifySession(
	supabase: SupabaseClient,
	token: string
): Promise<Session | null> {
	const { data: session, error: sessionError } = await withRetry(() =>
		supabase
			.from('sessions')
			.select('user_id')
			.eq('token_hash', hashToken(token))
			.gt('expires_at', new Date().toISOString())
			.maybeSingle()
	);
	if (sessionError) throw sessionError;
	if (!session) return null;

	const { data: user, error: userError } = await withRetry(() =>
		supabase.from('users').select('id, username').eq('id', session.user_id).maybeSingle()
	);
	if (userError) throw userError;
	if (!user) return null;

	return { userId: user.id, username: user.username };
}

/** Deletes the session row for `token`, if any — idempotent, safe to call
 * with an already-expired or unknown token (logout is a no-op then). */
export async function deleteSession(supabase: SupabaseClient, token: string): Promise<void> {
	const { error } = await withRetry(() =>
		supabase.from('sessions').delete().eq('token_hash', hashToken(token))
	);
	if (error) throw error;
}
