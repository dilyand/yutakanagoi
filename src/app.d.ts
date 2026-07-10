/// <reference types="vite-plugin-pwa/svelte" />
// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		interface Locals {
			// Populated by hooks.server.ts from a verified session cookie —
			// undefined means no valid session (route handlers should call
			// requireUserId, which throws 401).
			userId?: number;
			username?: string;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	// Injected by vite.config.ts's `define` from package.json's version field.
	const __APP_VERSION__: string;
}

export {};
