<script lang="ts">
	import '../app.css';
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import LoginForm from '$lib/components/LoginForm.svelte';
	import { apiPost } from '$lib/client/api-client';
	import { applyStoredFontSize } from '$lib/client/font-size';
	import { applyStoredTheme } from '$lib/client/theme';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();

	async function logout() {
		await apiPost('/api/logout', {});
		await invalidateAll();
	}

	if (browser) {
		applyStoredFontSize();
		applyStoredTheme();

		import('virtual:pwa-register/svelte').then(({ useRegisterSW }) => {
			useRegisterSW({ immediate: true });
		});
	}
</script>

<svelte:head>
	<link rel="icon" type="image/png" href="/icons/icon-192.png" />
</svelte:head>

{#if data.user}
	<button class="lock-button" onclick={logout}>Log out</button>
	{@render children()}
{:else}
	<LoginForm />
{/if}
