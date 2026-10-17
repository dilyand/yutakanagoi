<script lang="ts">
	import { gradeTyped, typedNext } from '$lib/target-practice/grading';
	import { toGradeInput } from '$lib/target-practice/grade';
	import type { GradeInput, GradeVerdict } from '$lib/target-practice/grade';
	import type { LearnerResponse } from '$lib/target-practice/flags';
	import type { Outcome, ResultInput } from '$lib/target-practice/session';
	import type { TypedItem } from '$lib/target-practice/types';
	import ItemPrompt from './ItemPrompt.svelte';
	import JaText from './JaText.svelte';

	// The hint ladder (design doc §7): two attempts. Every local miss goes to
	// Claude first (an acceptable alternative counts as correct); only a verdict of
	// "not acceptable" advances the ladder — hint after the first, reveal after the
	// second. If Claude can't be reached the item is neutral: the key is shown, the
	// item isn't scored or re-queued.
	let {
		item,
		grade,
		onDone,
		onReport
	}: {
		item: TypedItem;
		grade: (input: GradeInput) => Promise<GradeVerdict | null>;
		onDone: (result: ResultInput) => void;
		/** Tells the flag button what was answered and graded, so a flag carries it. */
		onReport?: (response: LearnerResponse) => void;
	} = $props();

	let answer = $state('');
	let attempt = $state<1 | 2>(1);
	let checking = $state(false);
	let finished = $state<{ outcome: Outcome; feedback: string } | null>(null);
	let lastAnswer = '';

	$effect(() => {
		if (!finished) return;
		onReport?.({
			answer: lastAnswer,
			outcome: finished.outcome,
			// The neutral message is canned, not the grader's.
			graderFeedback: finished.outcome === 'neutral' ? undefined : finished.feedback,
			attempts: attempt
		});
	});

	async function submit() {
		const text = answer.trim();
		if (!text || checking || finished) return;
		lastAnswer = text;
		if (gradeTyped(item, text)) {
			finished = { outcome: 'correct', feedback: '' };
			return;
		}
		checking = true;
		const input = toGradeInput(item, text);
		const verdict = input ? await grade(input) : null;
		checking = false;
		if (verdict === null) {
			finished = {
				outcome: 'neutral',
				feedback: "Couldn't check this one — compare your answer with the key yourself."
			};
		} else if (verdict.correct) {
			finished = { outcome: 'correct', feedback: verdict.feedback };
		} else if (typedNext(attempt) === 'hint') {
			attempt = 2;
		} else {
			finished = { outcome: 'wrong', feedback: verdict.feedback };
		}
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

{#if attempt === 2 && !finished}
	<p class="hint-line"><strong>Hint:</strong> {item.hint}</p>
{/if}

{#if finished}
	<div
		class="feedback-card"
		class:feedback-card--correct={finished.outcome === 'correct'}
		class:feedback-card--incorrect={finished.outcome === 'wrong'}
	>
		{#if finished.outcome === 'correct'}
			<span class="feedback-card__icon" aria-hidden="true">✓</span>Correct.
		{:else if finished.outcome === 'wrong'}
			<span class="feedback-card__icon" aria-hidden="true">✕</span>
		{/if}
		{#if finished.outcome !== 'correct'}
			<p class="revealed-answer">Answer: <JaText text={item.answer} /></p>
			{#if finished.outcome === 'wrong'}<p class="tp-note">{item.rationale}</p>{/if}
		{/if}
		{#if finished.feedback}<p class="tp-note">{finished.feedback}</p>{/if}
	</div>
	<button
		class="button-primary"
		onclick={() => onDone({ outcome: finished!.outcome, attempts: attempt, answer: lastAnswer })}
		>Next</button
	>
{:else}
	<button class="button-primary" onclick={submit} disabled={checking || answer.trim() === ''}>
		{#if checking}<span class="spinner" aria-hidden="true"></span>{/if}
		{checking ? 'Checking…' : 'Check'}
	</button>
{/if}
