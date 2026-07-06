import type { Handle, HandleServerError } from '@sveltejs/kit';
import { logError } from '$lib/server/logger';

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
	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('X-Frame-Options', 'DENY');
	return response;
};
