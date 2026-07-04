import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';

/**
 * Service-role Supabase client. Server-only — the app never exposes Supabase
 * to the browser directly (see the access-control design in the PWA
 * migration plan); every DB read/write goes through server code that uses
 * this client.
 */
export function createServiceClient() {
	const url = env.SUPABASE_URL;
	const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

	if (!url || !serviceRoleKey) {
		throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
	}

	return createClient(url, serviceRoleKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
}
