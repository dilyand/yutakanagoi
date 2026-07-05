<script lang="ts">
	import { browser } from '$app/environment';
	import { authorizedGet } from '$lib/client/api-client';
	import { getStoredUserId, setStoredUserId, clearStoredUserId } from '$lib/client/user-selection';

	interface AppUser {
		id: number;
		username: string;
	}

	let { onSelect }: { onSelect: (userId: number, username: string) => void } = $props();

	type Status = 'loading' | 'ready' | 'error';
	let status = $state<Status>('loading');
	let users = $state<AppUser[]>([]);
	let errorMessage = $state('');

	async function load() {
		status = 'loading';
		errorMessage = '';
		try {
			const data = await authorizedGet<{ users: AppUser[] }>('/api/users');
			users = data.users;
			status = 'ready';

			const storedUserId = getStoredUserId();
			if (storedUserId !== null) {
				const storedUser = users.find((u) => u.id === storedUserId);
				if (storedUser) {
					onSelect(storedUser.id, storedUser.username);
				} else {
					clearStoredUserId();
				}
			}
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
			status = 'error';
		}
	}

	if (browser) {
		load();
	}

	function handleChange(e: Event) {
		const select = e.currentTarget as HTMLSelectElement;
		const userId = Number(select.value);
		const user = users.find((u) => u.id === userId);
		if (!user) return;
		setStoredUserId(user.id);
		onSelect(user.id, user.username);
	}
</script>

{#if status === 'loading'}
	<p><span class="spinner" aria-hidden="true"></span>Loading users…</p>
{:else if status === 'error'}
	<p class="error">{errorMessage}</p>
{:else}
	<div class="card">
		<label class="field">
			<span>User:</span>
			<select onchange={handleChange}>
				<option value="" disabled selected>Choose a user</option>
				{#each users as user (user.id)}
					<option value={user.id}>{user.username}</option>
				{/each}
			</select>
		</label>
	</div>
{/if}
