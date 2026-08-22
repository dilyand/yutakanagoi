<script lang="ts">
	import {
		applyShadowingOutcome,
		ratingForHintLevel,
		type ShadowingRating
	} from '$lib/shadowing/rating';
	import type { WordState } from '$lib/drill-algorithm';
	import { apiPost } from '$lib/client/api-client';

	type Phase =
		'idle' | 'starting' | 'listening' | 'flagging' | 'completing' | 'done' | 'no-content';

	interface ShadowingDrillItem {
		chunkId: string;
		isNew: boolean;
		box?: number;
		box4Streak?: number;
		audioUrl: string;
		transcript: string;
		kana: string;
		translation: string;
		durationMs: number;
	}

	interface ShadowingSessionAttempt {
		chunkId: string;
		wasNewChunk: boolean;
		hintLevel: number;
		rating: ShadowingRating;
		replays: number;
		boxBefore: number;
		boxAfter: number;
	}

	let { username, onExit }: { username: string; onExit: () => void } = $props();

	let phase = $state<Phase>('idle');
	let errorMessage = $state('');

	let sessionIndex = $state(0);
	let drillItems = $state<ShadowingDrillItem[]>([]);
	let currentIndex = $state(0);

	// The rating is derived from how far up this ladder the user climbed
	// before advancing (see $lib/shadowing/rating.ts) — there's no separate
	// rating question to answer.
	let hintLevel = $state(0);
	let replays = $state(0);
	let hasPlayedOnce = $state(false);
	let playbackRate = $state(1);
	let flagNote = $state('');
	// Guards next()/confirmFlag()/cancelSession() against a double-click
	// firing a second request (and, on the last chunk, a second
	// session/complete write) while the first is still in flight.
	let isSubmitting = $state(false);
	// Set once recordFinalOutcome() has run for the current chunk, so a
	// retried Next after a failed session/complete (see finishSession())
	// doesn't push a second chunkStateUpdates/attempts entry for the same
	// chunk — a duplicate (user_id, chunk_id) pair in one batch upsert call
	// fails permanently, not just once.
	let outcomeRecorded = $state(false);

	let chunkStateUpdates: WordState[] = [];
	let attempts: ShadowingSessionAttempt[] = [];
	let wasCancelled = $state(false);

	let audioEl: HTMLAudioElement | undefined = $state();
	// Kicks off the next chunk's audio download while the current one plays,
	// so advancing isn't gated on the network. Held in a plain variable
	// (not $state) purely to keep the browser's fetch alive — it's never
	// rendered.
	let prefetchedAudio: HTMLAudioElement | undefined;

	let currentItem = $derived<ShadowingDrillItem | undefined>(drillItems[currentIndex]);
	let promptNumber = $derived(currentIndex + 1);
	let chunkLengthLabel = $derived(
		currentItem ? `${(currentItem.durationMs / 1000).toFixed(1)}s` : ''
	);
	let showWordBlock = $derived(
		currentItem !== undefined && (phase === 'listening' || phase === 'flagging')
	);

	function resetPerChunkState() {
		hintLevel = 0;
		replays = 0;
		hasPlayedOnce = false;
		playbackRate = 1;
		flagNote = '';
		outcomeRecorded = false;
		// The audio element is reused across chunks (only its src changes),
		// so its playbackRate is a live DOM property that outlives this
		// reset unless cleared explicitly — otherwise a 0.75x chunk leaves
		// the next chunk playing at 0.75x too, despite the toggle button
		// showing inactive.
		if (audioEl) audioEl.playbackRate = 1;
	}

	function prefetchNext() {
		const next = drillItems[currentIndex + 1];
		if (next) {
			prefetchedAudio = new Audio(next.audioUrl);
			prefetchedAudio.preload = 'auto';
		} else {
			prefetchedAudio = undefined;
		}
	}

	async function start() {
		phase = 'starting';
		errorMessage = '';
		wasCancelled = false;
		chunkStateUpdates = [];
		attempts = [];
		try {
			const data = await apiPost<{ sessionIndex: number; drillItems: ShadowingDrillItem[] }>(
				'/api/shadowing/session/start',
				{}
			);
			sessionIndex = data.sessionIndex;
			drillItems = data.drillItems;
			currentIndex = 0;
			resetPerChunkState();
			// An empty session here means no verified, unflagged content
			// exists for this user yet (never ingested, or everything's been
			// flagged) — session/start returns early with no drillItems
			// rather than starting a real session. Distinct from 'done',
			// which only follows an actual completed or cancelled session —
			// otherwise this reads as "Session complete" and offers another
			// identical, equally-empty session with no explanation.
			phase = drillItems.length === 0 ? 'no-content' : 'listening';
			if (drillItems.length > 0) prefetchNext();
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
			phase = 'idle';
		}
	}

	// Playback is always user-initiated — nothing plays on entry or on
	// advancing to the next chunk, only on an explicit tap here.
	function play() {
		if (!audioEl) return;
		errorMessage = '';
		audioEl.currentTime = 0;
		// hasPlayedOnce/replays are set from a real "ended" event (below),
		// not from this call — play() can reject (network/codec/CSP) or the
		// user can abandon it mid-clip, and neither should count as having
		// heard the chunk.
		audioEl.play().catch(() => {
			errorMessage = 'Playback failed — try again.';
		});
	}

	// Only a completed playthrough counts: the first sets hasPlayedOnce
	// (unlocking Next), every one after that counts as a replay.
	function handlePlaybackEnded() {
		if (hasPlayedOnce) {
			replays += 1;
		} else {
			hasPlayedOnce = true;
		}
	}

	// A failure that happens *after* play() has already started (a network
	// drop or decode error mid-stream) never rejects play()'s promise and
	// never fires "ended" — it surfaces only as this element's own "error"
	// event. Without a handler here, Next stays disabled with no
	// explanation and no way forward for a chunk whose first play attempt
	// hasn't completed yet. Flag remains a bail-out even without this, but
	// the actual fix is telling the user what happened and letting them
	// retry via the same Play button (play() already resets currentTime to
	// 0 before calling play() again).
	function handlePlaybackError() {
		errorMessage = 'Playback failed partway through — try again.';
	}

	function toggleSpeed() {
		playbackRate = playbackRate === 1 ? 0.75 : 1;
		if (audioEl) {
			audioEl.playbackRate = playbackRate;
			// Keeps pitch natural at 0.75x instead of dropping an octave.
			// preservesPitch is the current standard name; the webkit-prefixed
			// fallback covers older Safari.
			audioEl.preservesPitch = true;
			(audioEl as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch =
				true;
		}
	}

	function recordFinalOutcome(item: ShadowingDrillItem) {
		const rating = ratingForHintLevel(hintLevel);
		const boxBefore = item.isNew ? 0 : (item.box ?? 0);
		const outcome = applyShadowingOutcome({
			box: item.isNew ? undefined : item.box,
			box4Streak: item.isNew ? undefined : item.box4Streak,
			rating,
			sessionIndex
		});
		chunkStateUpdates.push({
			word: item.chunkId,
			box: outcome.box,
			lastSession: outcome.lastSession,
			box4Streak: outcome.box4Streak
		});
		attempts.push({
			chunkId: item.chunkId,
			wasNewChunk: item.isNew,
			hintLevel,
			rating,
			replays,
			boxBefore,
			boxAfter: outcome.box
		});
	}

	async function advance() {
		if (currentIndex + 1 >= drillItems.length) {
			await finishSession();
			return;
		}
		currentIndex += 1;
		resetPerChunkState();
		phase = 'listening';
		prefetchNext();
	}

	async function next() {
		if (!currentItem || isSubmitting) return;
		// hasPlayedOnce is only required to record a NEW outcome. If this
		// chunk is already handled (recorded via a prior Next, or flagged —
		// see confirmFlag()) and we're here again, it's a retry after a
		// failed session/complete on the last chunk: phase reverts to
		// 'listening' with this same chunk still current, and Next is the
		// only control shown. That retry must be able to proceed without
		// having (re)played a chunk that was already flagged as broken.
		if (!outcomeRecorded && !hasPlayedOnce) return;
		isSubmitting = true;
		try {
			// Only record once per chunk — see the retry note above for why
			// a second Next press here must not push a second
			// chunkStateUpdates/attempts entry for the same chunk.
			if (!outcomeRecorded) {
				recordFinalOutcome(currentItem);
				outcomeRecorded = true;
			}
			await advance();
		} finally {
			isSubmitting = false;
		}
	}

	function startFlag() {
		flagNote = '';
		phase = 'flagging';
	}

	function cancelFlag() {
		phase = 'listening';
	}

	// Flagging deliberately skips recordFinalOutcome — no rating or state
	// update for a chunk the user says is broken, and it drops out of
	// future session/start rotation server-side.
	async function confirmFlag() {
		if (!currentItem || isSubmitting) return;
		isSubmitting = true;
		errorMessage = '';
		try {
			await apiPost('/api/shadowing/chunks/flag', {
				chunkId: currentItem.chunkId,
				note: flagNote.trim() || undefined
			});
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
			phase = 'listening';
			isSubmitting = false;
			return;
		}
		// Flagging is a terminal decision for this chunk, same as recording
		// an outcome — marks it handled so a retry after a failed
		// session/complete (see next()) doesn't re-flag it or, worse, fall
		// through to recording a graded outcome for a chunk the user just
		// said was broken.
		outcomeRecorded = true;
		await advance();
		isSubmitting = false;
	}

	/** Returns whether the save actually succeeded — cancelSession needs to know before it can claim the session as cancelled. */
	async function finishSession(): Promise<boolean> {
		phase = 'completing';
		errorMessage = '';
		try {
			await apiPost('/api/shadowing/session/complete', {
				sessionIndex,
				chunkStates: chunkStateUpdates.map((s) => ({
					chunkId: s.word,
					box: s.box,
					lastSession: s.lastSession,
					box4Streak: s.box4Streak
				})),
				attempts
			});
			phase = 'done';
			return true;
		} catch (e) {
			errorMessage = e instanceof Error ? e.message : String(e);
			phase = phase === 'completing' ? 'listening' : phase;
			return false;
		}
	}

	// Safe at any point between chunks: every attempt so far is already
	// recorded in chunkStateUpdates/attempts, so this just persists what's
	// been done and stops before drilling the remaining chunks.
	async function cancelSession() {
		if (isSubmitting) return;
		isSubmitting = true;
		try {
			// Only claim the session as cancelled once finishSession's save
			// actually succeeds — it catches its own errors and returns
			// normally rather than throwing, so setting this beforehand (or
			// unconditionally after) left it true even when nothing was
			// saved. If the user later completes a session normally after a
			// failed cancel attempt, the done screen must say "complete,"
			// not "cancelled."
			wasCancelled = await finishSession();
		} finally {
			isSubmitting = false;
		}
	}
</script>

{#if showWordBlock && currentItem}
	<div class="word-block">
		<div class="cell-header">
			<span class="badge">{promptNumber}.</span>
			<span class="badge">{chunkLengthLabel}</span>
		</div>

		<audio
			bind:this={audioEl}
			src={currentItem.audioUrl}
			preload="auto"
			onended={handlePlaybackEnded}
			onerror={handlePlaybackError}
			style="display: none"
		></audio>

		<div class="shadowing-controls">
			<button class="shadowing-play-button" onclick={play}>
				{hasPlayedOnce ? '▶ Replay' : '▶ Play'}
			</button>
			<div class="shadowing-secondary-controls">
				<button
					class:active={playbackRate === 0.75}
					aria-pressed={playbackRate === 0.75}
					onclick={toggleSpeed}>0.75×</button
				>
				<button onclick={startFlag} disabled={phase === 'flagging' || isSubmitting}>⚑ Flag</button>
			</div>
		</div>

		{#if hintLevel >= 1}
			<div class="hint-block">
				<p class="hint-line">{currentItem.transcript}</p>
				{#if hintLevel >= 2}<p class="hint-line hint-line--secondary">{currentItem.kana}</p>{/if}
				{#if hintLevel >= 3}<p class="hint-line hint-line--secondary">
						{currentItem.translation}
					</p>{/if}
			</div>
		{/if}

		{#if hintLevel < 3}
			<button class="hint-ladder-button" onclick={() => (hintLevel += 1)}>
				{hintLevel === 0 ? 'Show Japanese' : hintLevel === 1 ? 'Show kana' : 'Show English'}
			</button>
		{/if}
	</div>
{/if}

{#if phase === 'idle' || phase === 'starting'}
	<p class="subtitle">{username}</p>
	<button class="button-primary" onclick={start} disabled={phase === 'starting'}>
		{#if phase === 'starting'}<span class="spinner" aria-hidden="true"></span>{/if}
		{phase === 'starting' ? 'Starting…' : 'Start session'}
	</button>
	<p class="cancel"><button onclick={onExit}>Back to activities</button></p>
{:else if phase === 'done'}
	<p>{wasCancelled ? 'Session cancelled — progress saved.' : 'Session complete.'}</p>
	<button class="button-primary" onclick={start}>Start another session</button>
	<p class="cancel"><button onclick={onExit}>Back to activities</button></p>
{:else if phase === 'no-content'}
	<p>
		No shadowing content available yet — nothing has been ingested for this account, or every chunk
		has been flagged.
	</p>
	<p class="cancel"><button onclick={onExit}>Back to activities</button></p>
{:else if currentItem}
	<div class="interaction">
		<div class="interaction__actions">
			{#if phase === 'flagging'}
				<label class="field">
					<span>Note (optional):</span>
					<input
						type="text"
						bind:value={flagNote}
						disabled={isSubmitting}
						onkeydown={(e) => e.key === 'Enter' && confirmFlag()}
					/>
				</label>
				<button class="button-primary" onclick={confirmFlag} disabled={isSubmitting}
					>Flag and continue</button
				>
				<p class="cancel">
					<button onclick={cancelFlag} disabled={isSubmitting}>Cancel</button>
				</p>
			{:else}
				<button
					class="button-primary"
					onclick={next}
					disabled={(!outcomeRecorded && !hasPlayedOnce) || isSubmitting}>Next</button
				>
				<p class="cancel">
					<button onclick={cancelSession} disabled={isSubmitting}>Cancel session</button>
				</p>
			{/if}
		</div>
	</div>
{/if}

{#if phase === 'completing'}
	<p><span class="spinner" aria-hidden="true"></span>Saving…</p>
{/if}

{#if errorMessage}
	<p class="error">{errorMessage}</p>
{/if}
