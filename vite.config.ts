import { readFileSync } from 'node:fs';
import adapter from '@sveltejs/adapter-vercel';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { SvelteKitPWA } from '@vite-pwa/sveltekit';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'));

export default defineConfig({
	define: {
		__APP_VERSION__: JSON.stringify(pkg.version)
	},
	plugins: [
		sveltekit({
			compilerOptions: {
				// Force runes mode for the project, except for libraries. Can be removed in svelte 6.
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true
			},
			adapter: adapter({ runtime: 'nodejs22.x' }),
			// CSP lives here, not as a hand-rolled header in hooks.server.ts: SvelteKit
			// inlines a small hydration bootstrap <script> into every page, and its
			// content (script chunk filenames) changes every build, so a static
			// script-src can never match it. Kit computes a per-request nonce and
			// injects it into both the header and that inline script automatically.
			csp: {
				directives: {
					'default-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:'],
					'connect-src': ['self'],
					'worker-src': ['self'],
					'manifest-src': ['self'],
					'base-uri': ['self'],
					'frame-ancestors': ['none']
				}
			}
		}),
		SvelteKitPWA({
			registerType: 'autoUpdate',
			manifest: {
				name: 'Yutakanagoi',
				short_name: 'Yutakanagoi',
				description: 'Japanese vocabulary spaced-repetition drills',
				start_url: '/',
				display: 'standalone',
				background_color: '#ffffff',
				theme_color: '#4f46e5',
				icons: [
					{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
					{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
					{
						src: '/icons/icon-512-maskable.png',
						sizes: '512x512',
						type: 'image/png',
						purpose: 'maskable'
					}
				]
			},
			workbox: {
				// Navigation always goes to the network (drill state must be fresh,
				// never served stale) — only fall back to the precached offline
				// page when the network request itself fails.
				runtimeCaching: [
					{
						urlPattern: ({ request }) => request.mode === 'navigate',
						handler: 'NetworkOnly',
						options: {
							precacheFallback: { fallbackURL: '/offline.html' }
						}
					}
				]
			}
		})
	]
});
