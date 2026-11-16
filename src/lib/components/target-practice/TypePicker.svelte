<script lang="ts">
	import { BUILT_TYPES, GUIDANCE, isBuilt } from '$lib/target-practice/input-guidance';
	import type { RecentTarget } from '$lib/target-practice/lookup';
	import type { TargetType } from '$lib/target-practice/types';

	let {
		recents,
		onPick,
		onRecent,
		onRemoveRecent,
		onExit
	}: {
		recents: RecentTarget[];
		onPick: (type: TargetType) => void;
		onRecent: (recent: RecentTarget) => void;
		onRemoveRecent: (recent: RecentTarget) => void;
		onExit: () => void;
	} = $props();

	// Only built types are offered; a stored target of another type (e.g. from
	// local testing) would open a session the UI can't run.
	let shown = $derived(recents.filter((r) => isBuilt(r.type)));
</script>

<div class="card">
	<h2 class="tp-title">What do you want to practise?</h2>
	{#each BUILT_TYPES as type (type)}
		<div class="field">
			<button class="button-primary" onclick={() => onPick(type)}>{GUIDANCE[type].label}</button>
			<p class="subtitle">{GUIDANCE[type].blurb}</p>
		</div>
	{/each}
</div>

{#if shown.length > 0}
	<div class="card">
		<h2 class="tp-title">Recent</h2>
		<ul class="tp-chips">
			{#each shown as recent (recent.type + recent.targetKey)}
				<li class="tp-chip">
					<button type="button" class="tp-chip-main" onclick={() => onRecent(recent)}>
						<span class="ja-text" lang="ja">{recent.card.target}</span>
						<span class="badge">{GUIDANCE[recent.type].label}</span>
					</button>
					<button
						type="button"
						class="tp-chip-remove"
						aria-label={`Remove ${recent.card.target} from recent targets`}
						onclick={() => onRemoveRecent(recent)}>×</button
					>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<p class="cancel"><button onclick={onExit}>Back to activities</button></p>
