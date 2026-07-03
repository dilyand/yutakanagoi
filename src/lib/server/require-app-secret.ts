import { error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

/** Throws a SvelteKit error() (401/500) unless the request's Authorization
 * header matches APP_SHARED_SECRET. Every server route that touches Supabase
 * or Claude calls this first — see the access-control design in the PWA
 * migration plan. */
export function requireAppSecret(request: Request): void {
	const expectedSecret = env.APP_SHARED_SECRET;
	if (!expectedSecret) {
		error(500, 'APP_SHARED_SECRET is not configured.');
	}

	const authHeader = request.headers.get('authorization');
	const providedSecret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
	if (providedSecret !== expectedSecret) {
		error(401, 'Unauthorized');
	}
}
