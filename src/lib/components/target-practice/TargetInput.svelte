<script lang="ts">
	import { validateTargetInput } from '$lib/target-practice/input-validation';
	import { GUIDANCE } from '$lib/target-practice/input-guidance';
	import type { TargetType } from '$lib/target-practice/types';

	let {
		type,
		initial = '',
		busy,
		onSubmit,
		onBack
	}: {
		type: TargetType;
		initial?: string;
		busy: boolean;
		onSubmit: (value: string) => void;
		onBack: () => void;
	} = $props();

	const guidance = $derived(GUIDANCE[type]);
	// Seeded from the prop; the field is the learner's from then on.
	let value = $derived(initial);
	let localError = $state('');

	function submit() {
		if (busy) return;
		const check = validateTargetInput(type, value);
		if (!check.ok) {
			localError = check.message;
			return;
		}
		localError = '';
		onSubmit(check.value);
	}
</script>

<div class="card">
	<h2 class="tp-title">{guidance.label}</h2>
	<p class="subtitle">{guidance.note}</p>
	<div class="field">
		<label for="tp-target-input">Your target</label>
		<input
			id="tp-target-input"
			type="text"
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			placeholder={guidance.placeholder}
			bind:value
			disabled={busy}
			onkeydown={(e) => e.key === 'Enter' && !e.isComposing && submit()}
		/>
	</div>
	<ul class="tp-chips">
		{#each guidance.chips as chip (chip)}
			<li>
				<button
					type="button"
					class="tp-chip-example"
					disabled={busy}
					onclick={() => (value = chip)}
				>
					{chip}
				</button>
			</li>
		{/each}
	</ul>
	{#if localError}<p class="error">{localError}</p>{/if}
	<button class="button-primary" onclick={submit} disabled={busy}>
		{#if busy}<span class="spinner" aria-hidden="true"></span>{/if}
		{busy ? 'Looking it up…' : 'Continue'}
	</button>
	<p class="cancel"><button onclick={onBack} disabled={busy}>Back</button></p>
</div>
