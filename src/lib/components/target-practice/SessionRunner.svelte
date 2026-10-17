<script lang="ts">
	import { targetKey } from '$lib/target-practice/lookup';
	import type { GenerationStage } from '$lib/target-practice/generation';
	import type { GradeInput, GradeVerdict } from '$lib/target-practice/grade';
	import { ITEM_FLAG_REASONS } from '$lib/target-practice/flags';
	import { PHASE_LABELS } from '$lib/target-practice/input-guidance';
	import { currentItem, currentPhaseId } from '$lib/target-practice/session';
	import type { ResultInput, SessionState } from '$lib/target-practice/session';
	import ClaudeView from './ClaudeView.svelte';
	import FlagButton from './FlagButton.svelte';
	import McView from './McView.svelte';
	import PhaseBoundary from './PhaseBoundary.svelte';
	import TilesView from './TilesView.svelte';
	import TypedView from './TypedView.svelte';

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
	let phase = $derived(currentPhaseId(session));
	let key = $derived(targetKey(session.card));
</script>

{#if session.at === 'boundary'}
	<PhaseBoundary {session} {onContinue} {onFinish} {onRetry} />
{:else if item}
	{#key item.id}
		<div class="card">
			<div class="tp-item-head">
				<span class="badge">{PHASE_LABELS[phase]}</span>
				<span class="subtitle">
					{item.spare ? 'Extra practice' : `${session.pos + 1} of ${session.queue.length}`}
				</span>
			</div>
			{#if item.kind === 'mc'}
				<McView {item} onDone={onResult} />
			{:else if item.kind === 'typed'}
				<TypedView {item} {grade} onDone={onResult} />
			{:else if item.kind === 'tiles'}
				<TilesView {item} onDone={onResult} />
			{:else}
				<ClaudeView {item} {grade} onDone={onResult} />
			{/if}
			<FlagButton
				type={session.card.type}
				targetKey={key}
				phase={item.phase}
				{item}
				reasons={ITEM_FLAG_REASONS}
			/>
		</div>
	{/key}
	<p class="cancel"><button onclick={onFinish}>End session</button></p>
{/if}
