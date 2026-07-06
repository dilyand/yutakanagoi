import type { Handle, HandleServerError } from '@sveltejs/kit';
import { logError } from '$lib/server/logger';

// Only fires for genuinely unexpected exceptions — routes that call
// SvelteKit's error() (400/401/403/409/429/502) are "expected" errors and
// never reach this hook, so this only ever logs real bugs/outages.
export const handleError: HandleServerError = ({ error: err, event }) => {
	logError(event.route?.id ?? event.url.pathname, err);
	return { message: 'Something went wrong. Please try again.' };
};

// No inline <script>s exist in this app, so script-src holds at 'self' with
// no unsafe-inline/nonces. worker-src/manifest-src cover the PWA service
// worker + manifest.
const CSP =
	"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data:; connect-src 'self'; worker-src 'self'; " +
	"manifest-src 'self'; base-uri 'self'; frame-ancestors 'none'";

export const handle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	response.headers.set('X-Content-Type-Options', 'nosniff');
	response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
	response.headers.set('X-Frame-Options', 'DENY');
	response.headers.set('Content-Security-Policy', CSP);
	return response;
};
