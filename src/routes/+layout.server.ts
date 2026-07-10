import type { LayoutServerLoad } from './$types';

// Available to every page via SvelteKit's automatic parent-data merge —
// +page.svelte reads data.user without needing its own load function.
export const load: LayoutServerLoad = ({ locals }) => {
	return {
		user: locals.userId ? { id: locals.userId, username: locals.username! } : null
	};
};
