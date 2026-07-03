<script lang="ts">
	import favicon from '$lib/assets/favicon.svg';
	import { browser } from '$app/environment';

	let { children } = $props();

	if (browser) {
		import('virtual:pwa-register/svelte').then(({ useRegisterSW }) => {
			useRegisterSW({ immediate: true });
		});
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
