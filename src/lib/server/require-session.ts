import { error } from '@sveltejs/kit';

/**
 * Throws a SvelteKit error() (401) unless locals.userId is set. locals.userId
 * is populated only by hooks.server.ts, from a verified session cookie —
 * never from anything a request body/query string can supply, which is the
 * whole point (see the 2.2.0 per-user-auth design in CLAUDE.md).
 */
export function requireUserId(locals: App.Locals): number {
	if (locals.userId === undefined) {
		error(401, 'Unauthorized');
	}
	return locals.userId;
}
