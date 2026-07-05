<script lang="ts">
	import { browser } from '$app/environment';
	import { authorizedGet, authorizedPost } from '$lib/client/api-client';

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
		try {
			const text = await file.text();
			const words = text
				.split('\n')
				.map((line) => line.trim())
				.filter((line) => line.length > 0);
			const result = await authorizedPost<{ listId: number }>('/api/lists/upload', {
				userId,
				name: file.name,
				words
			});
			onSelect(result.listId, file.name);
		} catch (e) {
			uploadError = e instanceof Error ? e.message : String(e);
		} finally {
			uploading = false;
			input.value = '';
		}
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
			<input type="file" accept=".txt,.md" onchange={handleFileUpload} disabled={uploading} />
		</label>
		{#if uploading}
			<p><span class="spinner" aria-hidden="true"></span>Uploading…</p>
		{/if}
		{#if uploadError}
			<p class="error">{uploadError}</p>
		{/if}
	</div>
{/if}
