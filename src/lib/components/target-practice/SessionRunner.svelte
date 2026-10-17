<script lang="ts">
	import type { GenerationStage } from '$lib/target-practice/generation';
	import type { GradeInput, GradeVerdict } from '$lib/target-practice/grade';
	import { currentItem } from '$lib/target-practice/session';
	import type { ResultInput, SessionState } from '$lib/target-practice/session';
	import ItemBlock from './ItemBlock.svelte';
	import PhaseBoundary from './PhaseBoundary.svelte';

	// Renders the current step of a session: one item, or a phase boundary. All
	// state lives in `session` (session.ts); this only reports what the learner did.
	let {
		session,
		grade,
		onResult,
		onContinue,
		onFinish,
		onRetry
	}: {
		session: SessionState;
		grade: (input: GradeInput) => Promise<GradeVerdict | null>;
		onResult: (result: ResultInput) => void;
		onContinue: () => void;
		onFinish: () => void;
		onRetry: (stage: GenerationStage) => void;
	} = $props();

	let item = $derived(currentItem(session));
</script>

{#if session.at === 'boundary'}
	<PhaseBoundary {session} {onContinue} {onFinish} {onRetry} />
{:else if item}
	{#key item.id}
		<ItemBlock {item} {session} {grade} {onResult} />
	{/key}
	<p class="cancel"><button onclick={onFinish}>End session</button></p>
{/if}
