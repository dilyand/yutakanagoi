<script lang="ts">
	import { applyOutcome, type DrillItem, type WordState } from '$lib/drill-algorithm';
	import { gradeAnswer, explainWord, evaluateSentence } from '$lib/client/evaluate-client';
	import { authorizedPost } from '$lib/client/api-client';
	import ListSelector from '$lib/components/ListSelector.svelte';

	type Phase =
		| 'idle'
		| 'starting'
		| 'guessing'
		| 'grading'
		| 'correct'
		| 'incorrect'
		| 'sentence-grading'
		| 'sentence-feedback'
		| 'completing'
		| 'done';

	interface SessionAttempt {
		word: string;
		wasNewWord: boolean;
		correct: boolean;
		boxBefore: number;
		boxAfter: number;
		userAnswer?: string;
	}

	let { userId, username, onExit }: { userId: number; username: string; onExit: () => void } =
		$props();

	let selectedListId = $state<number | null>(null);
	let selectedListName = $state('');

	let phase = $state<Phase>('idle');
	let errorMessage = $state('');

	let sessionIndex = $state(0);
	let drillItems = $state<DrillItem[]>([]);
	let currentIndex = $state(0);

	let answerInput = $state('');
	let sentenceInput = $state('');
	let gradeExplanation = $state('');
	let wordMeaning = $state('');
	let sentenceFeedback = $state('');

	let wordStateUpdates: WordState[] = [];
	let attempts: SessionAttempt[] = [];
	let wasCancelled = $state(false);

	let currentItem = $derived<DrillItem | undefined>(drillItems[currentIndex]);
	let promptNumber = $derived(currentIndex + 1);
	let showWordBlock = $derived(
		currentItem !== undefined && phase !== 'idle' && phase !== 'starting' && phase !== 'done'
	);

	function resetPerWordState() {
		answerInput = '';
		sentenceInput = '';
		gradeExplanation = '';
		wordMeaning = '';
		sentenceFeedback = '';
	}

	async function start() {
		if (selectedListId === null) return;
		phase = 'starting';
		errorMessage = '';
		wasCancelled = false;
		wordStateUpdates = [];
		attempts = [];
		try {
			const data = await authorizedPost<{ sessionIndex: number; drillItems: DrillItem[] }>(
				'/api/session/start',
				{ listId: selectedListId, userId }
			);
			sessionIndex = data.sessionIndex;
			drillItems = data.drillItems;
			currentIndex = 0;
			resetPerWordState();
			phase = drillItems.length === 0 ? 'done' : 'guessing';
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
			phase = 'idle';
		}
	}

	function recordOutcome(item: DrillItem, correct: boolean, userAnswer: string) {
		const boxBefore = item.isNew ? 0 : item.box;
		const outcome = applyOutcome({
			box: item.isNew ? undefined : item.box,
			correct,
			sessionIndex
		});
		wordStateUpdates.push({ word: item.word, box: outcome.box, lastSession: outcome.lastSession });
		attempts.push({
			word: item.word,
			wasNewWord: item.isNew,
			correct,
			boxBefore,
			boxAfter: outcome.box,
			userAnswer
		});
	}

	async function submitAnswer() {
		if (!currentItem) return;
		phase = 'grading';
		errorMessage = '';
		try {
			const result = await gradeAnswer(currentItem.word, answerInput);
			if (result.correct) {
				recordOutcome(currentItem, true, answerInput);
				gradeExplanation = result.explanation;
				phase = 'correct';
			} else {
				recordOutcome(currentItem, false, answerInput);
				gradeExplanation = result.explanation;
				const explained = await explainWord(currentItem.word);
				wordMeaning = explained.meaning;
				phase = 'incorrect';
			}
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
			phase = 'guessing';
		}
	}

	async function submitSentence() {
		if (!currentItem) return;
		phase = 'sentence-grading';
		errorMessage = '';
		try {
			const result = await evaluateSentence(currentItem.word, sentenceInput);
			sentenceFeedback = result.feedback;
			phase = 'sentence-feedback';
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
			phase = 'incorrect';
		}
	}

	async function next() {
		if (currentIndex + 1 >= drillItems.length) {
			await finishSession();
			return;
		}
		currentIndex += 1;
		resetPerWordState();
		phase = 'guessing';
	}

	async function finishSession() {
		if (selectedListId === null) return;
		phase = 'completing';
		errorMessage = '';
		try {
			await authorizedPost('/api/session/complete', {
				listId: selectedListId,
				userId,
				sessionIndex,
				wordStates: wordStateUpdates,
				attempts
			});
			phase = 'done';
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
			phase = 'sentence-feedback';
		}
	}

	// Safe at any point between words: every attempt so far is already recorded
	// in wordStateUpdates/attempts, so this just persists whatever's been done
	// and stops before drilling the remaining words — nothing is lost.
	async function cancelSession() {
		wasCancelled = true;
		await finishSession();
	}

	function chooseNewList() {
		selectedListId = null;
		selectedListName = '';
		phase = 'idle';
	}
</script>

{#if showWordBlock && currentItem}
	<div class="word-block">
		<p class="prompt-number">{promptNumber}.</p>
		<p class="word">{currentItem.word}</p>
	</div>
{/if}

{#if selectedListId === null}
	<ListSelector
		{userId}
		onSelect={(id, name) => {
			selectedListId = id;
			selectedListName = name;
		}}
	/>
{:else if phase === 'idle' || phase === 'starting'}
	<p class="subtitle">{username} · {selectedListName}</p>
	<button class="button-primary" onclick={start} disabled={phase === 'starting'}>
		{#if phase === 'starting'}<span class="spinner" aria-hidden="true"></span>{/if}
		{phase === 'starting' ? 'Starting…' : 'Start session'}
	</button>
	<p class="cancel"><button onclick={chooseNewList}>Choose a different list</button></p>
	<p class="cancel"><button onclick={onExit}>Back to activities</button></p>
{:else if phase === 'done'}
	<p>{wasCancelled ? 'Session cancelled — progress saved.' : 'Session complete.'}</p>
	<button class="button-primary" onclick={start}>Start another session</button>
	<button onclick={chooseNewList}>Choose a different list</button>
	<p class="cancel"><button onclick={onExit}>Back to activities</button></p>
{:else if currentItem}
	<div class="interaction">
		<div class="interaction__middle">
			{#if phase === 'guessing' || phase === 'grading'}
				<input
					type="text"
					bind:value={answerInput}
					disabled={phase === 'grading'}
					onkeydown={(e) => e.key === 'Enter' && phase === 'guessing' && submitAnswer()}
				/>
			{:else if phase === 'correct'}
				<div class="feedback-card feedback-card--correct">
					<span class="feedback-card__icon" aria-hidden="true">✓</span>{gradeExplanation}
				</div>
			{:else if phase === 'incorrect' || phase === 'sentence-grading'}
				<div class="feedback-card feedback-card--incorrect">
					<span class="feedback-card__icon" aria-hidden="true">✕</span>{wordMeaning}
				</div>
				<div class="field">
					<span>Write a sentence using this word:</span>
					<input
						type="text"
						bind:value={sentenceInput}
						disabled={phase === 'sentence-grading'}
						onkeydown={(e) => e.key === 'Enter' && phase === 'incorrect' && submitSentence()}
					/>
				</div>
			{:else if phase === 'sentence-feedback'}
				<div class="feedback-card">{sentenceFeedback}</div>
			{/if}
		</div>

		<div class="interaction__actions">
			{#if phase === 'guessing' || phase === 'grading'}
				<button class="button-primary" onclick={submitAnswer} disabled={phase === 'grading'}>
					{#if phase === 'grading'}<span class="spinner" aria-hidden="true"></span>{/if}
					{phase === 'grading' ? 'Grading…' : 'Submit'}
				</button>
			{:else if phase === 'correct'}
				<button class="button-primary" onclick={next}>Next</button>
			{:else if phase === 'incorrect' || phase === 'sentence-grading'}
				<button
					class="button-primary"
					onclick={submitSentence}
					disabled={phase === 'sentence-grading'}
				>
					{#if phase === 'sentence-grading'}<span class="spinner" aria-hidden="true"></span>{/if}
					{phase === 'sentence-grading' ? 'Grading…' : 'Submit'}
				</button>
			{:else if phase === 'sentence-feedback'}
				<button class="button-primary" onclick={next}>Next</button>
			{/if}

			<p class="cancel"><button onclick={cancelSession}>Cancel session</button></p>
		</div>
	</div>
{/if}

{#if phase === 'completing'}
	<p><span class="spinner" aria-hidden="true"></span>Saving…</p>
{/if}

{#if errorMessage}
	<p class="error">{errorMessage}</p>
{/if}
