<script lang="ts">
	import { toGradeInput } from '$lib/target-practice/grade';
	import type { GradeInput, GradeVerdict } from '$lib/target-practice/grade';
	import type { Outcome, ResultInput } from '$lib/target-practice/session';
	import type { ClaudeItem } from '$lib/target-practice/types';
	import ItemPrompt from './ItemPrompt.svelte';
	import JaText from './JaText.svelte';

	// Use phase: free production graded by Claude, one attempt (design doc §7). Its
	// feedback is the explanation. If Claude can't be reached the item is neutral and
	// an example answer is shown to compare against.
	let {
		item,
		grade,
		onDone
	}: {
		item: ClaudeItem;
		grade: (input: GradeInput) => Promise<GradeVerdict | null>;
		onDone: (result: ResultInput) => void;
	} = $props();

	let answer = $state('');
	let checking = $state(false);
	let finished = $state<{ outcome: Outcome; feedback: string } | null>(null);
	let submitted = '';

	async function submit() {
		const text = answer.trim();
		if (!text || checking || finished) return;
		submitted = text;
		checking = true;
		const input = toGradeInput(item, text);
		const verdict = input ? await grade(input) : null;
		checking = false;
		finished = verdict
			? { outcome: verdict.correct ? 'correct' : 'wrong', feedback: verdict.feedback }
			: {
					outcome: 'neutral',
					feedback: "Couldn't check this one — compare your answer with the example yourself."
				};
	}
</script>

<ItemPrompt {item} />
<div class="field">
	<input
		type="text"
		lang="ja"
		autocomplete="off"
		autocapitalize="off"
		spellcheck="false"
		aria-label="Your answer"
		bind:value={answer}
		disabled={checking || finished !== null}
		onkeydown={(e) => e.key === 'Enter' && !e.isComposing && submit()}
	/>
</div>

{#if finished}
	<div
		class="feedback-card"
		class:feedback-card--correct={finished.outcome === 'correct'}
		class:feedback-card--incorrect={finished.outcome === 'wrong'}
	>
		{#if finished.outcome === 'correct'}
			<span class="feedback-card__icon" aria-hidden="true">✓</span>
		{:else if finished.outcome === 'wrong'}
			<span class="feedback-card__icon" aria-hidden="true">✕</span>
		{/if}
		{finished.feedback}
		{#if finished.outcome !== 'correct' && item.expected.length > 0}
			<p class="tp-note">Example: <JaText text={item.expected[0]} /></p>
		{/if}
	</div>
	<button
		class="button-primary"
		onclick={() => onDone({ outcome: finished!.outcome, attempts: 1, answer: submitted })}
		>Next</button
	>
{:else}
	<button class="button-primary" onclick={submit} disabled={checking || answer.trim() === ''}>
		{#if checking}<span class="spinner" aria-hidden="true"></span>{/if}
		{checking ? 'Checking…' : 'Check'}
	</button>
{/if}
