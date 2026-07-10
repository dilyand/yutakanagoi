<script lang="ts">
	import { browser } from '$app/environment';
	import { invalidateAll } from '$app/navigation';
	import { apiGet, apiPost, HttpError } from '$lib/client/api-client';

	interface AppUser {
		id: number;
		username: string;
	}

	type Status = 'loading' | 'ready' | 'error';
	let status = $state<Status>('loading');
	let users = $state<AppUser[]>([]);
	let loadError = $state('');

	let selectedUsername = $state('');
	let passwordInput = $state('');
	let signingIn = $state(false);
	let errorMessage = $state('');

	async function loadUsers() {
		status = 'loading';
		loadError = '';
		try {
			const data = await apiGet<{ users: AppUser[] }>('/api/users');
			users = data.users;
			status = 'ready';
		} catch (e) {
			loadError = e instanceof Error ? e.message : String(e);
			status = 'error';
		}
	}

	if (browser) {
		loadUsers();
	}

	async function submitLogin() {
		signingIn = true;
		errorMessage = '';
		try {
			await apiPost('/api/login', { username: selectedUsername, password: passwordInput });
			passwordInput = '';
			await invalidateAll();
		} catch (e) {
			errorMessage =
				e instanceof HttpError ? e.message : e instanceof Error ? e.message : String(e);
		} finally {
			signingIn = false;
		}
	}
</script>

<main>
	<div class="card">
		{#if status === 'loading'}
			<p><span class="spinner" aria-hidden="true"></span>Loading users…</p>
		{:else if status === 'error'}
			<p class="error">{loadError}</p>
		{:else}
			<label class="field">
				<span>User:</span>
				<select bind:value={selectedUsername} disabled={signingIn}>
					<option value="" disabled selected>Choose a user</option>
					{#each users as user (user.id)}
						<option value={user.username}>{user.username}</option>
					{/each}
				</select>
			</label>
			<label class="field">
				<span>Password:</span>
				<input
					type="password"
					bind:value={passwordInput}
					disabled={signingIn}
					onkeydown={(e) => e.key === 'Enter' && selectedUsername && submitLogin()}
				/>
			</label>
			<button
				class="button-primary"
				onclick={submitLogin}
				disabled={signingIn || !selectedUsername}
			>
				{#if signingIn}<span class="spinner" aria-hidden="true"></span>{/if}
				{signingIn ? 'Signing in…' : 'Sign in'}
			</button>
			{#if errorMessage}
				<p class="error">{errorMessage}</p>
			{/if}
		{/if}
	</div>
</main>
