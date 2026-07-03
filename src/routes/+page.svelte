<script lang="ts">
	import { applyOutcome, type DrillItem, type WordState } from '$lib/drill-algorithm';
	import { gradeAnswer, explainWord, evaluateSentence } from '$lib/client/evaluate-client';
	import { authorizedPost } from '$lib/client/api-client';

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
		sessionIndex: number;
		word: string;
		wasNewWord: boolean;
		correct: boolean;
		boxBefore: number;
		boxAfter: number;
		userAnswer?: string;
	}

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

	const wordStateUpdates: WordState[] = [];
	const attempts: SessionAttempt[] = [];

	let currentItem = $derived<DrillItem | undefined>(drillItems[currentIndex]);
	let promptNumber = $derived(currentIndex + 1);

	function resetPerWordState() {
		answerInput = '';
		sentenceInput = '';
		gradeExplanation = '';
		wordMeaning = '';
		sentenceFeedback = '';
	}

	async function start() {
		phase = 'starting';
		errorMessage = '';
		try {
			const data = await authorizedPost<{ sessionIndex: number; drillItems: DrillItem[] }>(
				'/api/session/start',
				{}
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
			sessionIndex,
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
		phase = 'completing';
		errorMessage = '';
		try {
			await authorizedPost('/api/session/complete', {
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
</script>

<main>
	{#if phase === 'idle' || phase === 'starting'}
		<h1>Yutakanagoi</h1>
		<button onclick={start} disabled={phase === 'starting'}>
			{phase === 'starting' ? 'Starting…' : 'Start session'}
		</button>
	{:else if phase === 'done'}
		<p>Session complete.</p>
	{:else if currentItem}
		<p class="prompt-number">{promptNumber}.</p>
		<p class="word">{currentItem.word}</p>

		{#if phase === 'guessing' || phase === 'grading'}
			<input
				type="text"
				bind:value={answerInput}
				disabled={phase === 'grading'}
				onkeydown={(e) => e.key === 'Enter' && phase === 'guessing' && submitAnswer()}
			/>
			<button onclick={submitAnswer} disabled={phase === 'grading'}>
				{phase === 'grading' ? 'Grading…' : 'Submit'}
			</button>
		{:else if phase === 'correct'}
			<p>{gradeExplanation}</p>
			<button onclick={next}>Next</button>
		{:else if phase === 'incorrect' || phase === 'sentence-grading'}
			<p>{wordMeaning}</p>
			<label>
				Write a sentence using this word:
				<input
					type="text"
					bind:value={sentenceInput}
					disabled={phase === 'sentence-grading'}
					onkeydown={(e) => e.key === 'Enter' && phase === 'incorrect' && submitSentence()}
				/>
			</label>
			<button onclick={submitSentence} disabled={phase === 'sentence-grading'}>
				{phase === 'sentence-grading' ? 'Grading…' : 'Submit'}
			</button>
		{:else if phase === 'sentence-feedback'}
			<p>{sentenceFeedback}</p>
			<button onclick={next}>Next</button>
		{/if}
	{/if}

	{#if phase === 'completing'}
		<p>Saving…</p>
	{/if}

	{#if errorMessage}
		<p class="error">{errorMessage}</p>
	{/if}
</main>
