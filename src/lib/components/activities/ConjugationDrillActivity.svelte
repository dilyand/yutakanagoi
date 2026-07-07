<script lang="ts">
	import type { WordState } from '$lib/drill-algorithm';
	import { applyConjugationOutcome, conjugate } from '$lib/conjugation-engine';
	import type { WordClass } from '$lib/conjugation-word-list';
	import { getFormLabel } from '$lib/conjugation-forms';
	import {
		checkConjugationLeniency,
		getConjugationExample,
		getConjugationHint
	} from '$lib/client/evaluate-client';
	import { authorizedPost } from '$lib/client/api-client';

	type Phase =
		| 'idle'
		| 'starting'
		| 'guessing'
		| 'checking'
		| 'correct'
		| 'retry'
		| 'revealed'
		| 'completing'
		| 'done';

	interface ConjugationDrillItem {
		cellId: string;
		word: string;
		wordClass: string;
		formId: string;
		isNew: boolean;
		box?: number;
	}

	interface ConjugationSessionAttempt {
		cellId: string;
		word: string;
		wasNewCell: boolean;
		correct: boolean;
		boxBefore: number;
		boxAfter: number;
		userAnswer?: string;
		attemptsUsed: number;
	}

	let { userId, username, onExit }: { userId: number; username: string; onExit: () => void } =
		$props();

	let phase = $state<Phase>('idle');
	let errorMessage = $state('');

	let sessionIndex = $state(0);
	let drillItems = $state<ConjugationDrillItem[]>([]);
	let currentIndex = $state(0);

	let answerInput = $state('');
	let hintText = $state('');
	let revealedAnswer = $state('');
	let exampleSentence = $state('');
	let exampleMeaning = $state('');

	// Grading is locked in from the first attempt only (see recordFinalOutcome)
	// — retries 2-3 are teaching, not additional grading, per the design.
	let attemptsThisCell = $state(1);
	let firstAttemptCorrect: boolean | null = null;

	let cellStateUpdates: WordState[] = [];
	let attempts: ConjugationSessionAttempt[] = [];
	let wasCancelled = $state(false);

	let currentItem = $derived<ConjugationDrillItem | undefined>(drillItems[currentIndex]);
	let promptNumber = $derived(currentIndex + 1);
	let formLabel = $derived(
		currentItem ? getFormLabel(currentItem.wordClass as WordClass, currentItem.formId) : ''
	);
	let showWordBlock = $derived(
		currentItem !== undefined && phase !== 'idle' && phase !== 'starting' && phase !== 'done'
	);

	function resetPerCellState() {
		answerInput = '';
		hintText = '';
		revealedAnswer = '';
		exampleSentence = '';
		exampleMeaning = '';
		attemptsThisCell = 1;
		firstAttemptCorrect = null;
	}

	async function start() {
		phase = 'starting';
		errorMessage = '';
		wasCancelled = false;
		cellStateUpdates = [];
		attempts = [];
		try {
			const data = await authorizedPost<{
				sessionIndex: number;
				drillItems: ConjugationDrillItem[];
			}>('/api/conjugation/session/start', { userId });
			sessionIndex = data.sessionIndex;
			drillItems = data.drillItems;
			currentIndex = 0;
			resetPerCellState();
			phase = drillItems.length === 0 ? 'done' : 'guessing';
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
			phase = 'idle';
		}
	}

	function recordFinalOutcome(item: ConjugationDrillItem, userAnswer: string) {
		const correct = firstAttemptCorrect ?? false;
		const boxBefore = item.isNew ? 0 : (item.box ?? 0);
		const outcome = applyConjugationOutcome({
			box: item.isNew ? undefined : item.box,
			correct,
			sessionIndex
		});
		cellStateUpdates.push({
			word: item.cellId,
			box: outcome.box,
			lastSession: outcome.lastSession
		});
		attempts.push({
			cellId: item.cellId,
			word: item.word,
			wasNewCell: item.isNew,
			correct,
			boxBefore,
			boxAfter: outcome.box,
			userAnswer,
			attemptsUsed: attemptsThisCell
		});
	}

	async function submitAnswer() {
		if (!currentItem) return;
		phase = 'checking';
		errorMessage = '';
		const item = currentItem;
		try {
			const canonical = conjugate(item.word, item.wordClass as WordClass, item.formId);
			let accepted = answerInput.trim() === canonical.trim();
			if (!accepted) {
				const leniency = await checkConjugationLeniency(canonical, answerInput);
				accepted = leniency.acceptable;
			}
			if (attemptsThisCell === 1) firstAttemptCorrect = accepted;

			if (accepted) {
				const example = await getConjugationExample(item.word, canonical);
				exampleSentence = example.sentence;
				exampleMeaning = example.meaning;
				recordFinalOutcome(item, answerInput);
				phase = 'correct';
			} else if (attemptsThisCell < 3) {
				const hint = await getConjugationHint(item.word, item.wordClass, item.formId, answerInput);
				hintText = hint.hint;
				attemptsThisCell += 1;
				answerInput = '';
				phase = 'retry';
			} else {
				revealedAnswer = canonical;
				recordFinalOutcome(item, answerInput);
				phase = 'revealed';
			}
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
			phase = 'guessing';
		}
	}

	async function next() {
		if (currentIndex + 1 >= drillItems.length) {
			await finishSession();
			return;
		}
		currentIndex += 1;
		resetPerCellState();
		phase = 'guessing';
	}

	async function finishSession() {
		phase = 'completing';
		errorMessage = '';
		try {
			await authorizedPost('/api/conjugation/session/complete', {
				userId,
				sessionIndex,
				cellStates: cellStateUpdates.map((s) => ({
					cellId: s.word,
					box: s.box,
					lastSession: s.lastSession
				})),
				attempts
			});
			phase = 'done';
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
			phase = phase === 'completing' ? 'revealed' : phase;
		}
	}

	// Safe at any point between cells: every attempt so far is already
	// recorded in cellStateUpdates/attempts, so this just persists whatever's
	// been done and stops before drilling the remaining cells.
	async function cancelSession() {
		wasCancelled = true;
		await finishSession();
	}
</script>

{#if showWordBlock && currentItem}
	<div class="word-block">
		<p class="prompt-number">{promptNumber}.</p>
		<p class="word">{currentItem.word}</p>
		<p class="subtitle">{formLabel}</p>
	</div>
{/if}

{#if phase === 'idle' || phase === 'starting'}
	<p class="subtitle">{username}</p>
	<div class="card">
		<p><strong>How this works</strong></p>
		<p class="subtitle">
			Each prompt shows a word and a target form (e.g. "causative passive past") — type the
			conjugated form. Compound forms chain multiple transformations together (causative passive
			past = causative + passive + past). If you get it wrong, you'll get a hint and can try again
			(up to 3 attempts) before the answer is revealed — only your first try counts toward your
			progress.
		</p>
	</div>
	<button class="button-primary" onclick={start} disabled={phase === 'starting'}>
		{#if phase === 'starting'}<span class="spinner" aria-hidden="true"></span>{/if}
		{phase === 'starting' ? 'Starting…' : 'Start session'}
	</button>
	<p class="cancel"><button onclick={onExit}>Back to activities</button></p>
{:else if phase === 'done'}
	<p>{wasCancelled ? 'Session cancelled — progress saved.' : 'Session complete.'}</p>
	<button class="button-primary" onclick={start}>Start another session</button>
	<p class="cancel"><button onclick={onExit}>Back to activities</button></p>
{:else if currentItem}
	<div class="interaction">
		<div class="interaction__middle">
			{#if phase === 'guessing' || phase === 'checking'}
				<input
					type="text"
					bind:value={answerInput}
					disabled={phase === 'checking'}
					onkeydown={(e) => e.key === 'Enter' && phase === 'guessing' && submitAnswer()}
				/>
			{:else if phase === 'retry'}
				<div class="feedback-card feedback-card--incorrect">
					<span class="feedback-card__icon" aria-hidden="true">✕</span>{hintText}
				</div>
				<div class="field">
					<span>Try again ({attemptsThisCell}/3):</span>
					<input
						type="text"
						bind:value={answerInput}
						onkeydown={(e) => e.key === 'Enter' && submitAnswer()}
					/>
				</div>
			{:else if phase === 'correct'}
				<div class="feedback-card feedback-card--correct">
					<span class="feedback-card__icon" aria-hidden="true">✓</span>{exampleSentence}
				</div>
				<p class="subtitle">{exampleMeaning}</p>
			{:else if phase === 'revealed'}
				<div class="feedback-card feedback-card--incorrect">
					<span class="feedback-card__icon" aria-hidden="true">✕</span>Correct answer: {revealedAnswer}
				</div>
			{/if}
		</div>

		<div class="interaction__actions">
			{#if phase === 'guessing' || phase === 'checking'}
				<button class="button-primary" onclick={submitAnswer} disabled={phase === 'checking'}>
					{#if phase === 'checking'}<span class="spinner" aria-hidden="true"></span>{/if}
					{phase === 'checking' ? 'Checking…' : 'Submit'}
				</button>
			{:else if phase === 'retry'}
				<button class="button-primary" onclick={submitAnswer}>Submit</button>
			{:else if phase === 'correct' || phase === 'revealed'}
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
