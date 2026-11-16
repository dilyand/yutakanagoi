<script lang="ts">
	import { gradeMc } from '$lib/target-practice/grading';
	import type { ResultInput } from '$lib/target-practice/session';
	import type { McItem } from '$lib/target-practice/types';
	import ItemPrompt from './ItemPrompt.svelte';
	import JaText from './JaText.svelte';

	// One attempt, then the rationale on a miss (design doc §7). Graded locally.
	let { item, onDone }: { item: McItem; onDone: (result: ResultInput) => void } = $props();

	let chosen = $state<number | null>(null);
	let right = $derived(chosen !== null && gradeMc(item, chosen));
</script>

<ItemPrompt {item} />
<div class="tp-options">
	{#each item.options as option, i (i)}
		<button
			type="button"
			class="tp-option"
			class:tp-option--correct={chosen !== null && option.correct}
			class:tp-option--wrong={chosen === i && !option.correct}
			disabled={chosen !== null}
			onclick={() => (chosen = i)}
		>
			<JaText text={option.text} />
		</button>
	{/each}
</div>

{#if chosen !== null}
	{#if right}
		<div class="feedback-card feedback-card--correct">
			<span class="feedback-card__icon" aria-hidden="true">✓</span>Correct.
		</div>
	{:else}
		<div class="feedback-card feedback-card--incorrect">
			<span class="feedback-card__icon" aria-hidden="true">✕</span>
			<!-- What is wrong with the option they picked first; why the key is right after. -->
			{#if item.options[chosen].why}
				<p class="tp-note">{item.options[chosen].why}</p>
			{/if}
			<p class="tp-note" class:tp-note--secondary={!!item.options[chosen].why}>{item.rationale}</p>
		</div>
	{/if}
	<button
		class="button-primary"
		onclick={() =>
			onDone({
				outcome: right ? 'correct' : 'wrong',
				attempts: 1,
				answer: item.options[chosen!].text,
				feedback: right ? undefined : item.options[chosen!].why
			})}>Next</button
	>
{/if}
