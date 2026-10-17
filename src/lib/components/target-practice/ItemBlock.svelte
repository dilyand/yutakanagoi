<script lang="ts">
	import { targetKey } from '$lib/target-practice/lookup';
	import type { GradeInput, GradeVerdict } from '$lib/target-practice/grade';
	import { ITEM_FLAG_REASONS, flagItemPayload } from '$lib/target-practice/flags';
	import type { LearnerResponse } from '$lib/target-practice/flags';
	import { PHASE_LABELS } from '$lib/target-practice/input-guidance';
	import type { ResultInput, SessionState } from '$lib/target-practice/session';
	import type { Item } from '$lib/target-practice/types';
	import ClaudeView from './ClaudeView.svelte';
	import FlagButton from './FlagButton.svelte';
	import McView from './McView.svelte';
	import TilesView from './TilesView.svelte';
	import TypedView from './TypedView.svelte';

	// One item on screen: its view plus the flag button. Rendered inside a {#key}
	// by SessionRunner, so `response` starts empty for every item. Typed and Use
	// items report what the learner answered and how it was graded; the flag then
	// carries that next to the item (flags.ts), so a bad grader comment is visible
	// in `npm run logs:flags`.
	let {
		item,
		session,
		grade,
		onResult
	}: {
		item: Item;
		session: SessionState;
		grade: (input: GradeInput) => Promise<GradeVerdict | null>;
		onResult: (result: ResultInput) => void;
	} = $props();

	let response = $state<LearnerResponse | null>(null);
</script>

<div class="card">
	<div class="tp-item-head">
		<span class="badge">{PHASE_LABELS[item.phase]}</span>
		<span class="subtitle">
			{item.spare ? 'Extra practice' : `${session.pos + 1} of ${session.queue.length}`}
		</span>
	</div>
	{#if item.kind === 'mc'}
		<McView {item} onDone={onResult} />
	{:else if item.kind === 'typed'}
		<TypedView {item} {grade} onDone={onResult} onReport={(r) => (response = r)} />
	{:else if item.kind === 'tiles'}
		<TilesView {item} onDone={onResult} />
	{:else}
		<ClaudeView {item} {grade} onDone={onResult} onReport={(r) => (response = r)} />
	{/if}
	<FlagButton
		type={session.card.type}
		targetKey={targetKey(session.card)}
		phase={item.phase}
		item={flagItemPayload(item, response)}
		reasons={ITEM_FLAG_REASONS}
	/>
</div>
