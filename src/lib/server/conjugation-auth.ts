import type { SupabaseClient } from '@supabase/supabase-js';
import { withRetry } from '$lib/server/retry';

export class UserNotFoundError extends Error {
	constructor() {
		super('User not found.');
		this.name = 'UserNotFoundError';
	}
}

/**
 * Throws UserNotFoundError unless userId exists. Conjugation drills have no
 * listId to check ownership against (see user-list-repository.ts's
 * verifyListOwnership) — this is the lighter equivalent for a domain with
 * one shared registry instead of per-user lists. userId here should always
 * be the session-derived id from requireUserId (see CLAUDE.md) — this just
 * guards a bug/typo, it isn't the identity check itself.
 */
export async function verifyUserExists(supabase: SupabaseClient, userId: number): Promise<void> {
	const { data, error } = await withRetry(() =>
		supabase.from('users').select('id').eq('id', userId).maybeSingle()
	);
	if (error) throw error;
	if (!data) throw new UserNotFoundError();
}
