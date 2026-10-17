<script lang="ts">
	import { gradeTiles } from '$lib/target-practice/grading';
	import type { ResultInput } from '$lib/target-practice/session';
	import type { TilesItem } from '$lib/target-practice/types';
	import ItemPrompt from './ItemPrompt.svelte';
	import JaText from './JaText.svelte';

	// Tap a tile to place it, tap a placed tile to return it, explicit Check — no
	// drag-and-drop (unreliable on touch and in a PWA; design doc §7). The tiles
	// arrive already shuffled by the server. One attempt, graded locally.
	let { item, onDone }: { item: TilesItem; onDone: (result: ResultInput) => void } = $props();

	let placed = $state<number[]>([]);
	let checked = $state<boolean | null>(null);

	let bank = $derived(item.tiles.map((_, i) => i).filter((i) => !placed.includes(i)));
	let sentence = $derived(placed.map((i) => item.tiles[i]).join(''));

	function check() {
		checked = gradeTiles(
			item,
			placed.map((i) => item.tiles[i])
		);
	}
</script>

<ItemPrompt {item} />
{#if !item.instruction && !item.sentence}
	<!-- The generator is told to give the English meaning, but nothing validates it. -->
	<p class="tp-instruction">Put the pieces in order to make a sentence.</p>
{/if}
<div class="tp-tiles-answer" aria-label="Your sentence">
	{#each placed as index (index)}
		<button
			type="button"
			class="tp-tile tp-tile--placed"
			disabled={checked !== null}
			onclick={() => (placed = placed.filter((i) => i !== index))}
		>
			<JaText text={item.tiles[index]} />
		</button>
	{:else}
		<span class="subtitle">Tap the pieces in order.</span>
	{/each}
</div>
<div class="tp-tiles-bank">
	{#each bank as index (index)}
		<button
			type="button"
			class="tp-tile"
			disabled={checked !== null}
			onclick={() => (placed = [...placed, index])}
		>
			<JaText text={item.tiles[index]} />
		</button>
	{/each}
</div>

{#if checked === null}
	<button class="button-primary" onclick={check} disabled={placed.length !== item.tiles.length}>
		Check
	</button>
{:else}
	{#if checked}
		<div class="feedback-card feedback-card--correct">
			<span class="feedback-card__icon" aria-hidden="true">✓</span>Correct.
		</div>
	{:else}
		<div class="feedback-card feedback-card--incorrect">
			<span class="feedback-card__icon" aria-hidden="true">✕</span>
			<p class="revealed-answer">One correct order: <JaText text={item.accepted[0] ?? ''} /></p>
			<p class="tp-note">{item.rationale}</p>
		</div>
	{/if}
	<button
		class="button-primary"
		onclick={() =>
			onDone({ outcome: checked ? 'correct' : 'wrong', attempts: 1, answer: sentence })}
		>Next</button
	>
{/if}
