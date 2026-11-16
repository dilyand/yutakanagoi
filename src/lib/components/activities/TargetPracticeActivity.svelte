<script lang="ts">
	import { onMount } from 'svelte';
	import {
		deleteRecent,
		fetchRecents,
		generate,
		grade,
		lookupCandidates,
		lookupCard
	} from '$lib/client/target-practice-client';
	import { clearSnapshot, loadSnapshot, saveSnapshot } from '$lib/client/target-practice-storage';
	import CandidatePicker from '$lib/components/target-practice/CandidatePicker.svelte';
	import FlagButton from '$lib/components/target-practice/FlagButton.svelte';
	import SessionRunner from '$lib/components/target-practice/SessionRunner.svelte';
	import TargetCard from '$lib/components/target-practice/TargetCard.svelte';
	import TargetInput from '$lib/components/target-practice/TargetInput.svelte';
	import TypePicker from '$lib/components/target-practice/TypePicker.svelte';
	import WrapUp from '$lib/components/target-practice/WrapUp.svelte';
	import { CARD_FLAG_REASONS } from '$lib/target-practice/flags';
	import type { GenerationStage } from '$lib/target-practice/generation';
	import type { GradeInput, GradeVerdict } from '$lib/target-practice/grade';
	import { GUIDANCE, isBuilt } from '$lib/target-practice/input-guidance';
	import { validateTargetInput } from '$lib/target-practice/input-validation';
	import { formatLimitMessage } from '$lib/target-practice/limit-message';
	import { targetKey } from '$lib/target-practice/lookup';
	import type { Candidate, RecentTarget } from '$lib/target-practice/lookup';
	import {
		applyStageFailure,
		applyStageResult,
		avoidFor,
		beginRetry,
		canStart,
		continueFromBoundary,
		finishHere,
		newSession,
		nextRound,
		recordResult,
		retryAction,
		start
	} from '$lib/target-practice/session';
	import type { ResultInput, SessionState } from '$lib/target-practice/session';
	import type { Card, TargetType } from '$lib/target-practice/types';

	let { username, userId, onExit }: { username: string; userId: number; onExit: () => void } =
		$props();

	type Screen = 'home' | 'input' | 'candidates' | 'card' | 'session' | 'wrapup';

	let screen = $state<Screen>('home');
	let type = $state<TargetType>('grammar');
	let lastInput = $state('');
	let candidates = $state<Candidate[]>([]);
	let busy = $state(false);
	let errorMessage = $state('');
	// A built type the card call suggested instead ("Switch to Grammar?").
	let switchOffer = $state<TargetType | null>(null);
	let recents = $state<RecentTarget[]>([]);
	let resumable = $state<SessionState | null>(null);
	let session = $state<SessionState | null>(null);
	// Where "Not what I meant" goes back to: a recent target never had an input screen.
	let fromRecent = false;

	// Bumped whenever a session is started, resumed or abandoned, so a response from an
	// earlier one (still in flight) is ignored instead of landing in the wrong session.
	// Not reactive on purpose.
	let generationToken = 0;

	onMount(async () => {
		resumable = loadSnapshot(userId);
		await refreshRecents();
	});

	async function refreshRecents() {
		try {
			recents = await fetchRecents();
		} catch {
			// Recent targets are a convenience; the picker works without them.
		}
	}

	// --- Lookup flow -------------------------------------------------------

	async function withBusy(fn: () => Promise<void>) {
		busy = true;
		errorMessage = '';
		try {
			await fn();
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
		} finally {
			busy = false;
		}
	}

	function pickType(t: TargetType) {
		type = t;
		lastInput = '';
		errorMessage = '';
		switchOffer = null;
		fromRecent = false;
		screen = 'input';
	}

	function submitInput(value: string) {
		const check = validateTargetInput(type, value);
		if (!check.ok) {
			errorMessage = check.message;
			return;
		}
		lastInput = check.value;
		switchOffer = null;
		return withBusy(async () => {
			if (!check.needsCandidates) {
				await buildCard({ type, target: check.value });
				return;
			}
			const res = await lookupCandidates(type, check.value);
			if (res.status === 'limit') {
				errorMessage = formatLimitMessage(res);
			} else if (res.status === 'none') {
				errorMessage = "Couldn't find a match for that — try rephrasing.";
			} else if (res.candidates.length === 1 && res.candidates[0].target === check.value) {
				// Nothing to choose between: the candidate IS what was typed (§2).
				const only = res.candidates[0];
				await buildCard({ type, target: only.target, reading: only.reading, gloss: only.gloss });
			} else {
				candidates = res.candidates;
				screen = 'candidates';
			}
		});
	}

	function pickCandidate(c: Candidate) {
		return withBusy(() =>
			buildCard({ type, target: c.target, reading: c.reading, gloss: c.gloss })
		);
	}

	async function buildCard(body: {
		type: TargetType;
		target: string;
		reading?: string;
		gloss?: string;
	}) {
		const res = await lookupCard(body);
		if (res.status === 'limit') {
			errorMessage = formatLimitMessage(res);
			return;
		}
		if (res.status === 'rejected') {
			const suggested = res.suggestedType;
			errorMessage = res.reason;
			if (suggested && isBuilt(suggested)) {
				switchOffer = suggested;
			} else if (suggested) {
				errorMessage += ` That looks like a ${GUIDANCE[suggested].label} target, which isn't available yet.`;
			}
			screen = 'input';
			return;
		}
		begin(newSession(res.card));
	}

	function switchType() {
		if (!switchOffer) return;
		type = switchOffer;
		switchOffer = null;
		submitInput(lastInput);
	}

	function openRecent(recent: RecentTarget) {
		type = recent.type;
		fromRecent = true;
		errorMessage = '';
		begin(newSession(recent.card));
	}

	async function removeRecent(recent: RecentTarget) {
		recents = recents.filter((r) => r !== recent);
		try {
			await deleteRecent(recent.type, recent.targetKey);
		} catch {
			// The chip is already gone from view; a failed delete reappears on the next visit.
		}
	}

	// --- Session ----------------------------------------------------------

	/** Starts a fresh session on the card screen and fires both generation stages at once. */
	function begin(fresh: SessionState) {
		generationToken += 1;
		session = fresh;
		persist();
		screen = 'card';
		void runStage(1, false);
		void runStage(2, false);
	}

	async function runStage(stage: GenerationStage, retry: boolean) {
		const token = generationToken;
		const current = session;
		if (!current) return;
		let apply: (s: SessionState) => SessionState;
		try {
			const res = await generate({
				stage,
				type: current.card.type,
				card: current.card,
				retry,
				avoid: avoidFor(current)
			});
			apply =
				res.status === 'limit'
					? (s) => applyStageFailure(s, stage, formatLimitMessage(res), true)
					: (s) => applyStageResult(s, stage, res);
		} catch (e) {
			const message = e instanceof Error ? e.message : 'Something went wrong.';
			apply = (s) => applyStageFailure(s, stage, message);
		}
		if (token !== generationToken) return;
		update(apply);
	}

	function persist() {
		if (!session) return;
		if (session.at === 'done') clearSnapshot(userId);
		else saveSnapshot(session, userId);
	}

	/** Applies a state change, then does what the new state calls for. */
	function update(fn: (s: SessionState) => SessionState) {
		if (!session) return;
		session = fn(session);
		// The one automatic retry of a short stage (§8); further retries are the learner's.
		for (const stage of [1, 2] as const) {
			if (session && retryAction(session, stage) === 'auto') {
				session = beginRetry(session, stage);
				void runStage(stage, true);
			}
		}
		if (session?.at === 'done' && screen === 'session') screen = 'wrapup';
		persist();
	}

	function retryStage(stage: GenerationStage) {
		update((s) => beginRetry(s, stage));
		void runStage(stage, true);
	}

	function startSession() {
		update(start);
		screen = 'session';
	}

	function backFromCard() {
		generationToken += 1;
		session = null;
		clearSnapshot(userId);
		screen = fromRecent ? 'home' : 'input';
	}

	function anotherRound() {
		if (session) begin(nextRound(session));
	}

	function newTarget() {
		generationToken += 1;
		session = null;
		clearSnapshot(userId);
		screen = 'home';
		void refreshRecents();
	}

	// --- Resume -----------------------------------------------------------

	function resume() {
		const saved = resumable;
		if (!saved) return;
		resumable = null;
		generationToken += 1;
		// A request that was in flight when the page went away is gone: re-fire it as a
		// retry (no new session counted) and let the stage's own retry flag start over.
		session = {
			...saved,
			stage1: { ...saved.stage1, retrying: false },
			stage2: { ...saved.stage2, retrying: false }
		};
		type = saved.card.type;
		fromRecent = true;
		screen = saved.at === 'not_started' ? 'card' : 'session';
		for (const stage of [1, 2] as const) {
			if ((stage === 1 ? saved.stage1 : saved.stage2).status === 'pending') {
				void runStage(stage, true);
			}
		}
		update((s) => s);
	}

	function discard() {
		resumable = null;
		clearSnapshot(userId);
	}

	// --- Grading ----------------------------------------------------------

	/** One fallback / Use grade; anything but a verdict (cap, outage) is the neutral path. */
	async function gradeOne(input: GradeInput): Promise<GradeVerdict | null> {
		const current = session;
		if (!current) return null;
		try {
			const res = await grade(current.card.type, current.card, [input]);
			return res.status === 'ok' ? (res.results[0] ?? null) : null;
		} catch {
			return null;
		}
	}

	let card = $derived<Card | null>(session?.card ?? null);
	let cardBlocked = $derived(
		session !== null && (session.stage1.blocked || retryAction(session, 1) === 'manual')
	);
</script>

{#if screen === 'home'}
	<p class="subtitle">{username}</p>
	{#if resumable}
		<div class="card">
			<h2 class="tp-title">Pick up where you left off?</h2>
			<p>
				{GUIDANCE[resumable.card.type].label}:
				<span class="ja-text" lang="ja">{resumable.card.target}</span>
			</p>
			<button class="button-primary" onclick={resume}>Resume</button>
			<button onclick={discard}>Discard</button>
		</div>
	{/if}
	<TypePicker
		{recents}
		onPick={pickType}
		onRecent={openRecent}
		onRemoveRecent={removeRecent}
		{onExit}
	/>
{:else if screen === 'input'}
	<TargetInput
		{type}
		initial={lastInput}
		{busy}
		onSubmit={submitInput}
		onBack={() => {
			errorMessage = '';
			switchOffer = null;
			screen = 'home';
		}}
	/>
	{#if switchOffer}
		<button class="button-primary" onclick={switchType}>
			Switch to {GUIDANCE[switchOffer].label}?
		</button>
	{/if}
{:else if screen === 'candidates'}
	<CandidatePicker
		{candidates}
		{busy}
		onPick={pickCandidate}
		onRephrase={() => {
			errorMessage = '';
			screen = 'input';
		}}
	/>
{:else if screen === 'card' && session && card}
	<TargetCard {card} />
	<div class="card">
		{#if canStart(session)}
			<button class="button-primary" onclick={startSession}>Start</button>
		{:else if cardBlocked}
			<p class="error">{session.stage1.message || "Couldn't prepare the practice."}</p>
			{#if !session.stage1.blocked}
				<button class="button-primary" onclick={() => retryStage(1)}>Retry</button>
			{/if}
		{:else}
			<p><span class="spinner" aria-hidden="true"></span>Preparing your practice…</p>
		{/if}
		<FlagButton
			type={card.type}
			targetKey={targetKey(card)}
			reasons={CARD_FLAG_REASONS}
			item={undefined}
		/>
		<p class="cancel"><button onclick={backFromCard}>Not what I meant</button></p>
	</div>
{:else if screen === 'session' && session}
	<SessionRunner
		{session}
		grade={gradeOne}
		onResult={(r: ResultInput) => update((s) => recordResult(s, r))}
		onContinue={() => update(continueFromBoundary)}
		onFinish={() => update(finishHere)}
		onRetry={retryStage}
	/>
{:else if screen === 'wrapup' && session}
	<WrapUp {session} onAnotherRound={anotherRound} onNewTarget={newTarget} />
{/if}

{#if errorMessage && (screen === 'input' || screen === 'candidates')}
	<p class="error">{errorMessage}</p>
{/if}
