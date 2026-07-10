import type { Handle, HandleServerError } from '@sveltejs/kit';
import { logError } from '$lib/server/logger';
import { createServiceClient } from '$lib/server/supabase';
import { SESSION_COOKIE_NAME, verifySession } from '$lib/server/session';

// Only fires for genuinely unexpected exceptions — routes that call
// SvelteKit's error() (400/401/403/409/429/502) are "expected" errors and
// never reach this hook, so this only ever logs real bugs/outages.
export const handleError: HandleServerError = ({ error: err, event }) => {
	logError(event.route?.id ?? event.url.pathname, err);
	return { message: 'Something went wrong. Please try again.' };
};

// CSP itself is configured in vite.config.ts's kit.csp (not here) — SvelteKit
// needs to own that header so it can inject a per-request nonce into its own
// inline hydration bootstrap script.
export const handle: Handle = async ({ event, resolve }) => {
	const token = event.cookies.get(SESSION_COOKIE_NAME);
	if (token) {
		const supabase = createServiceClient();
		const session = await verifySession(supabase, token);
		if (session) {
			event.locals.userId = session.userId;
			event.locals.username = session.username;
		} else {
			// Unknown/expired token — clear it so the client stops sending it.
			event.cookies.delete(SESSION_COOKIE_NAME, { path: '/' });
		}
	}

	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
	// The app uses none of these browser features — deny them all by default.
	response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
	return response;
};
