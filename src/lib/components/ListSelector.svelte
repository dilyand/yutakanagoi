<script lang="ts">
	import { browser } from '$app/environment';
	import { authorizedGet, authorizedPost, HttpError } from '$lib/client/api-client';
	import { deriveListName } from '$lib/list-naming';
	import { parseAnkiAppDeck } from '$lib/ankiapp-deck-parser';

	interface WordListSummary {
		id: number;
		name: string;
	}

	let {
		userId,
		onSelect
	}: { userId: number; onSelect: (listId: number, listName: string) => void } = $props();

	type Status = 'loading' | 'ready' | 'error';
	let status = $state<Status>('loading');
	let lists = $state<WordListSummary[]>([]);
	let errorMessage = $state('');
	let uploading = $state(false);
	let uploadError = $state('');
	let pendingUpdate = $state<{ name: string; words: string[] } | null>(null);
	let updateResult = $state<{ listId: number; name: string; addedCount: number } | null>(null);

	async function load() {
		status = 'loading';
		errorMessage = '';
		try {
			const data = await authorizedGet<{ lists: WordListSummary[] }>(`/api/lists?userId=${userId}`);
			lists = data.lists;
			status = 'ready';
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
		const listId = Number(select.value);
		const list = lists.find((l) => l.id === listId);
		if (!list) return;
		onSelect(list.id, list.name);
	}

	async function handleFileUpload(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		if (!file) return;

		uploading = true;
		uploadError = '';
		const name = deriveListName(file.name);
		const text = await file.text();
		let words: string[];
		try {
			words = file.name.toLowerCase().endsWith('.xml')
				? parseAnkiAppDeck(text)
				: text
						.split('\n')
						.map((line) => line.trim())
						.filter((line) => line.length > 0);
		} catch (e) {
			uploadError = e instanceof Error ? e.message : String(e);
			uploading = false;
			input.value = '';
			return;
		}
		try {
			const result = await authorizedPost<{ listId: number }>('/api/lists/upload', {
				userId,
				name,
				words
			});
			onSelect(result.listId, name);
		} catch (e) {
			if (e instanceof HttpError && e.status === 409) {
				pendingUpdate = { name, words };
			} else {
				uploadError = e instanceof Error ? e.message : String(e);
			}
		} finally {
			uploading = false;
			input.value = '';
		}
	}

	async function confirmUpdate() {
		if (!pendingUpdate) return;
		const { name, words } = pendingUpdate;

		uploading = true;
		uploadError = '';
		try {
			const result = await authorizedPost<{ listId: number; addedCount: number }>(
				'/api/lists/upload',
				{
					userId,
					name,
					words,
					update: true
				}
			);
			pendingUpdate = null;
			updateResult = { listId: result.listId, name, addedCount: result.addedCount };
		} catch (e) {
			uploadError = e instanceof Error ? e.message : String(e);
		} finally {
			uploading = false;
		}
	}

	function cancelUpdate() {
		pendingUpdate = null;
	}

	function continueToList() {
		if (!updateResult) return;
		const { listId, name } = updateResult;
		updateResult = null;
		onSelect(listId, name);
	}
</script>

{#if status === 'loading'}
	<p><span class="spinner" aria-hidden="true"></span>Loading lists…</p>
{:else if status === 'error'}
	<p class="error">{errorMessage}</p>
{:else}
	<div class="card">
		{#if lists.length === 0}
			<p>You don't have any word lists yet — upload one to get started.</p>
		{:else}
			<label class="field">
				<span>Word list:</span>
				<select onchange={handleChange}>
					<option value="" disabled selected>Choose a list</option>
					{#each lists as list (list.id)}
						<option value={list.id}>{list.name}</option>
					{/each}
				</select>
			</label>
		{/if}

		<label class="field">
			<span>Upload a new list</span>
			<input type="file" accept=".txt,.md,.xml" onchange={handleFileUpload} disabled={uploading} />
		</label>
		<p class="hint">Accepts .txt/.md (one word per line) or an AnkiApp .xml deck export.</p>
		{#if uploading}
			<p><span class="spinner" aria-hidden="true"></span>Uploading…</p>
		{/if}
		{#if uploadError}
			<p class="error">{uploadError}</p>
		{/if}
		{#if pendingUpdate}
			<p>
				A list named "{pendingUpdate.name}" already exists. Add any new words to it?
			</p>
			<button class="button-primary" onclick={confirmUpdate} disabled={uploading}>Update</button>
			<p class="cancel"><button onclick={cancelUpdate} disabled={uploading}>Cancel</button></p>
		{/if}
		{#if updateResult}
			<p>
				{#if updateResult.addedCount === 0}
					No new words to add — "{updateResult.name}" is already up to date.
				{:else}
					Added {updateResult.addedCount}
					{updateResult.addedCount === 1 ? 'word' : 'words'} to "{updateResult.name}".
				{/if}
			</p>
			<button class="button-primary" onclick={continueToList}>Continue</button>
		{/if}
	</div>
{/if}

<style>
	.hint {
		font-size: var(--font-size-tiny);
		color: var(--color-text-secondary);
	}
</style>
