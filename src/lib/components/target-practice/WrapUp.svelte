<script lang="ts">
	import { answerText } from '$lib/target-practice/grading';
	import { PHASE_LABELS } from '$lib/target-practice/input-guidance';
	import { missedItems, phaseScores } from '$lib/target-practice/session';
	import type { SessionState } from '$lib/target-practice/session';
	import JaText from './JaText.svelte';

	// Score per phase, the misses with the key and rationale (stored item data, no
	// call), a one-line takeaway from the card's rule, and where to go next.
	let {
		session,
		onAnotherRound,
		onNewTarget
	}: {
		session: SessionState;
		onAnotherRound: () => void;
		onNewTarget: () => void;
	} = $props();

	let scores = $derived(phaseScores(session));
	let missed = $derived(missedItems(session));
</script>

<div class="card">
	<h2 class="tp-title">{session.finishedEarly ? 'Session ended' : 'Session complete'}</h2>
	{#if scores.length === 0}
		<p class="subtitle">No items were answered.</p>
	{:else}
		<ul class="tp-scores">
			{#each scores as score (score.phase)}
				<li>
					<span>{PHASE_LABELS[score.phase]}</span>
					<span>
						{score.correct} / {score.correct + score.wrong + score.neutral}{score.neutral > 0
							? ` · ${score.neutral} not checked`
							: ''}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
	<p class="tp-rule"><strong>Takeaway:</strong> {session.card.rule}</p>
</div>

{#if missed.length > 0}
	<div class="card">
		<h2 class="tp-title">To review</h2>
		<ul class="tp-missed">
			{#each missed as m (m.item.id)}
				<li>
					{#if m.item.instruction}<p class="tp-instruction">{m.item.instruction}</p>{/if}
					{#if m.item.sentence}<p class="tp-sentence"><JaText text={m.item.sentence} /></p>{/if}
					{#if m.answer}<p class="subtitle">You answered: <JaText text={m.answer} /></p>{/if}
					{#if answerText(m.item)}<p>Answer: <JaText text={answerText(m.item)} /></p>{/if}
					{#if m.item.rationale}<p class="tp-note">{m.item.rationale}</p>{/if}
				</li>
			{/each}
		</ul>
	</div>
{/if}

<div class="card">
	<button class="button-primary" onclick={onAnotherRound}>Another round</button>
	<button onclick={onNewTarget}>New target</button>
</div>
