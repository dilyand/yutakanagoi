<script lang="ts">
	import type { Item } from '$lib/target-practice/types';
	import JaText from './JaText.svelte';

	// The shared top of every item: English task wording, the Japanese sentence
	// (reading on tap, the target highlighted where the item says so), and the
	// short cue that stays out of the sentence.
	let { item }: { item: Item } = $props();
</script>

{#if item.instruction}<p class="tp-instruction">{item.instruction}</p>{/if}
{#if item.sentence}
	<p class="tp-sentence">
		<!-- The highlight only belongs to typed items ("type the reading of the highlighted word"); in a
			multiple-choice item it was distracting and pointed at the answer. -->
		<JaText text={item.sentence} kana={item.kana} focus={item.kind === 'typed' ? item.focus : ''} />
	</p>
{/if}
{#if item.kind === 'typed' && item.cue}<p class="tp-cue"><JaText text={item.cue} /></p>{/if}
