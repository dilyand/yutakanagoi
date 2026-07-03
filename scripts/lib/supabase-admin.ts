import { createClient } from '@supabase/supabase-js';

/** Service-role Supabase client for one-time migration scripts. Never used by the app itself. */
export function createAdminClient() {
	const url = process.env.SUPABASE_URL;
	const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

	if (!url || !serviceRoleKey) {
		throw new Error(
			'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (e.g. via `node --env-file=.env`).'
		);
	}

	return createClient(url, serviceRoleKey, {
		auth: { autoRefreshToken: false, persistSession: false }
	});
}
