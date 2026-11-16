<script lang="ts">
	import { sendFlag } from '$lib/client/target-practice-client';
	import { FLAG_REASON_LABELS, MAX_FLAG_NOTE } from '$lib/target-practice/flags';
	import type { TargetType } from '$lib/target-practice/types';

	// Flags tune the generation prompts (design doc §8); they are not a fix queue,
	// so the form stays minimal: a reason and an optional note.
	let {
		type,
		targetKey,
		phase,
		item,
		reasons
	}: {
		type: TargetType;
		targetKey: string;
		phase?: string;
		item?: unknown;
		reasons: readonly string[];
	} = $props();

	let open = $state(false);
	let reason = $state('');
	let note = $state('');
	let sending = $state(false);
	let sent = $state(false);
	let errorMessage = $state('');

	async function submit() {
		if (!reason) return;
		sending = true;
		errorMessage = '';
		try {
			await sendFlag({
				type,
				targetKey,
				...(phase ? { phase } : {}),
				...(item === undefined ? {} : { item }),
				reason,
				...(note.trim() ? { note: note.trim() } : {})
			});
			sent = true;
			open = false;
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
		} finally {
			sending = false;
		}
	}
</script>

<div class="tp-flag">
	{#if sent}
		<p class="subtitle">Thanks — flagged.</p>
	{:else if !open}
		<button type="button" class="tp-link-button" onclick={() => (open = true)}
			>⚑ Flag a problem</button
		>
	{:else}
		<div class="tp-flag-form">
			<div class="field">
				<label for="tp-flag-reason">What is wrong?</label>
				<select id="tp-flag-reason" bind:value={reason} disabled={sending}>
					<option value="" disabled>Choose…</option>
					{#each reasons as r (r)}
						<option value={r}>{FLAG_REASON_LABELS[r] ?? r}</option>
					{/each}
				</select>
			</div>
			<div class="field">
				<label for="tp-flag-note">Note (optional)</label>
				<input
					id="tp-flag-note"
					type="text"
					maxlength={MAX_FLAG_NOTE}
					bind:value={note}
					disabled={sending}
				/>
			</div>
			<div class="tp-row">
				<button type="button" class="button-primary" onclick={submit} disabled={!reason || sending}>
					{sending ? 'Sending…' : 'Send'}
				</button>
				<button type="button" onclick={() => (open = false)} disabled={sending}>Cancel</button>
			</div>
			{#if errorMessage}<p class="error">{errorMessage}</p>{/if}
		</div>
	{/if}
</div>
