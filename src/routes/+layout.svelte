<script lang="ts">
	import '../app.css';
	import favicon from '$lib/assets/favicon.svg';
	import { browser } from '$app/environment';
	import PassphraseGate from '$lib/components/PassphraseGate.svelte';
	import { applyStoredFontSize } from '$lib/client/font-size';

	let { children } = $props();

	if (browser) {
		applyStoredFontSize();

		import('virtual:pwa-register/svelte').then(({ useRegisterSW }) => {
			useRegisterSW({ immediate: true });
		});
	}
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

<PassphraseGate>
	{@render children()}
</PassphraseGate>
