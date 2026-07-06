<script lang="ts">
	import { ACTIVITIES } from '$lib/activities';

	let { onSelect }: { onSelect: (activityId: string) => void } = $props();
</script>

<div class="card">
	{#each ACTIVITIES as activity (activity.id)}
		<div class="field">
			<button class="button-primary" onclick={() => onSelect(activity.id)}>
				{activity.label}
			</button>
			{#if activity.description}
				<p class="subtitle">{activity.description}</p>
			{/if}
		</div>
	{/each}
</div>
