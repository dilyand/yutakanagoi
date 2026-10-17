<script lang="ts">
	import type { Candidate } from '$lib/target-practice/lookup';
	import JaText from './JaText.svelte';

	let {
		candidates,
		busy,
		onPick,
		onRephrase
	}: {
		candidates: Candidate[];
		busy: boolean;
		onPick: (candidate: Candidate) => void;
		onRephrase: () => void;
	} = $props();
</script>

<div class="card">
	<h2 class="tp-title">Which one do you mean?</h2>
	<ul class="tp-candidates">
		{#each candidates as candidate (candidate.target + candidate.reading)}
			<li>
				<button class="tp-candidate" disabled={busy} onclick={() => onPick(candidate)}>
					<span class="tp-candidate-target"><JaText text={candidate.target} /></span>
					<span class="tp-candidate-reading"><JaText text={candidate.reading} /></span>
					<span class="subtitle">{candidate.gloss}</span>
				</button>
			</li>
		{/each}
	</ul>
	{#if busy}<p class="subtitle">
			<span class="spinner" aria-hidden="true"></span>Building the card…
		</p>{/if}
	<p class="cancel">
		<button onclick={onRephrase} disabled={busy}>None of these — rephrase</button>
	</p>
</div>
