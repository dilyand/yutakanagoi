import { defineConfig } from 'vitest/config';
import { sveltekit } from '@sveltejs/kit/vite';

// The sveltekit() plugin is needed here (not just in vite.config.ts) so that
// test files can import modules that use $env/$lib aliases (e.g.
// require-app-secret.ts imports $env/dynamic/private) — those are virtual
// modules SvelteKit's Vite plugin resolves, not real files on disk.
export default defineConfig({
	plugins: [sveltekit()],
	test: {
		environment: 'node',
		include: ['src/**/*.test.ts']
	}
});
