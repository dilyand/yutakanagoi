<script lang="ts">
	import { hasJapaneseScript } from '$lib/target-practice/normalize';

	// ALL Japanese text in target practice renders through this component (design
	// doc §6), so the later tokenizer / ruby upgrade only changes this file and
	// the data shape behind it. `kana` is the masked reading line a prompt
	// sentence carries, shown on tap; `\n` (dialogue: one speaker per line) is
	// rendered as a line break.
	let { text, kana = '', focus = '' }: { text: string; kana?: string; focus?: string } = $props();

	let showReading = $state(false);

	// Option text is sometimes English; only tag real Japanese so hyphenation
	// and font choice stay right for the rest.
	let lang = $derived(hasJapaneseScript(text) ? 'ja' : undefined);
	let parts = $derived.by(() => {
		const at = focus ? text.indexOf(focus) : -1;
		if (at < 0) return { before: text, mid: '', after: '' };
		return {
			before: text.slice(0, at),
			mid: focus,
			after: text.slice(at + focus.length)
		};
	});
</script>

{#snippet body()}
	<span class="ja-text" {lang}
		>{parts.before}{#if parts.mid}<mark class="ja-focus">{parts.mid}</mark>{/if}{parts.after}</span
	>
{/snippet}

{#if kana}
	<span class="ja-block">
		{@render body()}
		<button
			type="button"
			class="reading-toggle"
			aria-expanded={showReading}
			onclick={() => (showReading = !showReading)}
		>
			{showReading ? 'Hide reading' : 'Show reading'}
		</button>
		{#if showReading}<span class="ja-kana" lang="ja">{kana}</span>{/if}
	</span>
{:else}
	{@render body()}
{/if}
