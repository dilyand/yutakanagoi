<script lang="ts">
	import type { GenerationStage } from '$lib/target-practice/generation';
	import { PHASE_LABELS } from '$lib/target-practice/input-guidance';
	import {
		currentPhaseId,
		nextPhaseInfo,
		phaseScores,
		phases,
		slotOf
	} from '$lib/target-practice/session';
	import type { SessionState } from '$lib/target-practice/session';

	// Between phases (design doc §8): the score for the phase just finished, then
	// Continue — or, while the next phase's stage is still being generated, a
	// "preparing" state, or Retry / Finish here when it failed. Finish here is
	// always offered: at a boundary at least one phase is complete.
	let {
		session,
		onContinue,
		onFinish,
		onRetry
	}: {
		session: SessionState;
		onContinue: () => void;
		onFinish: () => void;
		onRetry: (stage: GenerationStage) => void;
	} = $props();

	let done = $derived(currentPhaseId(session));
	let score = $derived(phaseScores(session).find((s) => s.phase === done));
	let next = $derived(nextPhaseInfo(session));
	let nextStage = $derived(next ? phases(session).find((p) => p.id === next.phase)!.stage : 1);
	let slot = $derived(slotOf(session, nextStage));
</script>

<div class="card">
	<h2 class="tp-title">{PHASE_LABELS[done]} done</h2>
	{#if score}
		<p>
			{score.correct} of {score.correct + score.wrong + score.neutral} correct{score.neutral > 0
				? ` (${score.neutral} not checked)`
				: ''}.
		</p>
	{/if}

	{#if next?.status === 'ready'}
		<p class="subtitle">Next: {PHASE_LABELS[next.phase]}</p>
		<button class="button-primary" onclick={onContinue}>Continue</button>
	{:else if next?.status === 'waiting'}
		<p><span class="spinner" aria-hidden="true"></span>Preparing the next phase…</p>
	{:else if next}
		<p class="error">{slot.message || "Couldn't prepare the next phase."}</p>
		{#if !slot.blocked}
			<button class="button-primary" onclick={() => onRetry(nextStage)} disabled={slot.retrying}>
				Retry
			</button>
		{/if}
	{/if}
	<button onclick={onFinish}>Finish here</button>
</div>
