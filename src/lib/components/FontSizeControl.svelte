<script lang="ts">
	import { browser } from '$app/environment';
	import {
		FONT_SIZES_PX,
		DEFAULT_FONT_SIZE_PX,
		getStoredFontSize,
		setStoredFontSize
	} from '$lib/client/font-size';

	// +layout.svelte already applies the stored size to the page on load —
	// this just needs to know the current value to render/disable the buttons.
	let fontSizePx = $state(browser ? getStoredFontSize() : DEFAULT_FONT_SIZE_PX);

	function step(direction: 1 | -1) {
		const index = FONT_SIZES_PX.indexOf(fontSizePx as (typeof FONT_SIZES_PX)[number]);
		const nextIndex = Math.min(Math.max(index + direction, 0), FONT_SIZES_PX.length - 1);
		fontSizePx = FONT_SIZES_PX[nextIndex];
		setStoredFontSize(fontSizePx);
	}
</script>

<div class="font-size-control">
	<button
		onclick={() => step(-1)}
		disabled={fontSizePx === FONT_SIZES_PX[0]}
		aria-label="Decrease text size"
	>
		A-
	</button>
	<button
		onclick={() => step(1)}
		disabled={fontSizePx === FONT_SIZES_PX[FONT_SIZES_PX.length - 1]}
		aria-label="Increase text size"
	>
		A+
	</button>
</div>
