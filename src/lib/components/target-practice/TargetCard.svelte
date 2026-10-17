<script lang="ts">
	import type { Card } from '$lib/target-practice/types';
	import JaText from './JaText.svelte';

	// The Notice phase (design doc §4): the confirmed card plus its model
	// sentences, ungraded. The card schema carries no kana line, so these
	// sentences have no reading toggle (accepted for 3.2.0; the flag button is
	// the error path).
	let { card }: { card: Card } = $props();
</script>

<div class="card tp-target-card">
	<div class="tp-target-head">
		<p class="tp-target"><JaText text={card.target} /></p>
		{#if 'reading' in card}<p class="tp-target-reading"><JaText text={card.reading} /></p>{/if}
	</div>
	<p class="tp-rule">{card.rule}</p>

	{#if card.type === 'grammar'}
		<dl class="tp-facts">
			<dt>Form</dt>
			<dd>{card.form}</dd>
			<dt>Use</dt>
			<dd>{card.use}</dd>
			<dt>Watch out</dt>
			<dd>{card.watchOut}</dd>
		</dl>
	{:else if card.type === 'word'}
		<ol class="tp-senses">
			{#each card.senses as sense (sense.id)}
				<li>
					<strong>{sense.gloss}</strong>
					<span class="tp-sense-example"><JaText text={sense.example} /></span>
				</li>
			{/each}
		</ol>
		{#if card.lessCommonSenses > 0}
			<p class="subtitle">
				{card.lessCommonSenses} less common {card.lessCommonSenses === 1 ? 'sense' : 'senses'} not covered.
			</p>
		{/if}
		{#if card.forms.length > 0}
			<p class="subtitle">Common forms: <JaText text={card.forms.join('、')} /></p>
		{/if}
	{/if}

	{#if card.modelSentences.length > 0}
		<ul class="tp-model-sentences">
			{#each card.modelSentences as sentence (sentence)}
				<li><JaText text={sentence} /></li>
			{/each}
		</ul>
	{/if}
</div>
