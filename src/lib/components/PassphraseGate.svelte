<script lang="ts">
	import { browser } from '$app/environment';
	import {
		getStoredAppSecret,
		setStoredAppSecret,
		clearStoredAppSecret
	} from '$lib/client/app-secret';

	let { children } = $props();

	type GateStatus = 'checking' | 'locked' | 'unlocked';
	let gateStatus = $state<GateStatus>('checking');
	let passphraseInput = $state('');
	let verifying = $state(false);
	let errorMessage = $state('');

	async function verify(secret: string): Promise<boolean> {
		const response = await fetch('/api/verify-secret', {
			method: 'POST',
			headers: { Authorization: `Bearer ${secret}` }
		});
		return response.ok;
	}

	async function checkStoredSecret() {
		const stored = getStoredAppSecret();
		if (!stored) {
			gateStatus = 'locked';
			return;
		}
		const ok = await verify(stored);
		if (ok) {
			gateStatus = 'unlocked';
		} else {
			clearStoredAppSecret();
			gateStatus = 'locked';
		}
	}

	if (browser) {
		checkStoredSecret();
	}

	async function submitPassphrase() {
		verifying = true;
		errorMessage = '';
		try {
			const ok = await verify(passphraseInput);
			if (ok) {
				setStoredAppSecret(passphraseInput);
				gateStatus = 'unlocked';
			} else {
				errorMessage = 'Incorrect passphrase.';
			}
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
		} finally {
			verifying = false;
		}
	}
</script>

{#if gateStatus === 'unlocked'}
	{@render children()}
{:else if gateStatus === 'locked'}
	<main>
		<div class="card">
			<label class="field">
				<span>Passphrase:</span>
				<input
					type="password"
					bind:value={passphraseInput}
					disabled={verifying}
					onkeydown={(e) => e.key === 'Enter' && submitPassphrase()}
				/>
			</label>
			<button class="button-primary" onclick={submitPassphrase} disabled={verifying}>
				{#if verifying}<span class="spinner" aria-hidden="true"></span>{/if}
				{verifying ? 'Checking…' : 'Unlock'}
			</button>
			{#if errorMessage}
				<p class="error">{errorMessage}</p>
			{/if}
		</div>
	</main>
{/if}
