<script lang="ts">
	import { fade } from 'svelte/transition';
	import ActivityPicker from '$lib/components/ActivityPicker.svelte';
	import VocabDrillActivity from '$lib/components/activities/VocabDrillActivity.svelte';
	import ConjugationDrillActivity from '$lib/components/activities/ConjugationDrillActivity.svelte';
	import FontSizeControl from '$lib/components/FontSizeControl.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import { transitionDuration } from '$lib/client/motion';
	import type { PageProps } from './$types';

	// The year of the project's first commit — never changes. See CLAUDE.md:
	// the footer's copyright range is self-maintaining (this constant plus the
	// current year computed below), not something to hand-update per release.
	const FOUNDING_YEAR = 2026;
	const currentYear = new Date().getFullYear();
	const copyrightYears =
		currentYear > FOUNDING_YEAR ? `${FOUNDING_YEAR}–${currentYear}` : `${FOUNDING_YEAR}`;

	// data.user is guaranteed non-null here — +layout.svelte only renders this
	// page once a session is confirmed (see +layout.server.ts).
	let { data }: PageProps = $props();
	let username = $derived(data.user!.username);

	let selectedActivityId = $state<string | null>(null);
</script>

<main>
	<div class="top-anchor">
		<div class="controls-row">
			<ThemeToggle />
			<FontSizeControl />
		</div>
	</div>

	<div class="content-area">
		{#if selectedActivityId === null}
			<div transition:fade={{ duration: transitionDuration(150) }}>
				<ActivityPicker
					onSelect={(id) => {
						selectedActivityId = id;
					}}
				/>
			</div>
		{:else if selectedActivityId === 'vocab-drill'}
			<div class="activity-screen" transition:fade={{ duration: transitionDuration(150) }}>
				<VocabDrillActivity
					{username}
					onExit={() => {
						selectedActivityId = null;
					}}
				/>
			</div>
		{:else if selectedActivityId === 'conjugation-drill'}
			<div class="activity-screen" transition:fade={{ duration: transitionDuration(150) }}>
				<ConjugationDrillActivity
					{username}
					onExit={() => {
						selectedActivityId = null;
					}}
				/>
			</div>
		{/if}
	</div>

	<footer class="app-footer">
		Yutakanagoi <span class="version">v{__APP_VERSION__}</span> · © {copyrightYears} Dilyan Damyanov
	</footer>
</main>
