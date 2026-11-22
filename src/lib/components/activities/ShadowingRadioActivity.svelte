<script lang="ts">
	import { tick } from 'svelte';
	import { apiPost } from '$lib/client/api-client';
	import {
		DEFAULT_RADIO_REPEATS,
		MAX_RADIO_REPEATS,
		MIN_RADIO_REPEATS,
		clampRepeats,
		nextPosition,
		startPosition,
		type RadioPosition
	} from '$lib/shadowing/radio-sequencer';

	// 'playing' covers paused too — see `paused`. 'starting' is only the wait
	// for the first playlist; everything after that is 'playing' even while
	// it's fetching the next clip's URL.
	type Phase = 'idle' | 'starting' | 'playing' | 'no-content';

	interface RadioClip {
		chunkId: string;
		audioUrl: string;
		transcript: string;
		kana: string;
		translation: string;
		durationMs: number;
	}

	type Action = (run: number) => Promise<void>;

	// Silence between plays and between clips, so one clip doesn't run
	// straight into the next.
	const GAP_MS = 1000;

	// Played inside the Start tap to "unlock" the audio element — see start().
	// Served from static/ (same origin) rather than a data: URI because the
	// app's CSP media-src doesn't allow data:.
	const UNLOCK_SRC = '/silence.wav';

	// Guards against a pathological loop if the server keeps listing ids it
	// then won't serve — see playCurrentClip().
	const MAX_SKIPPED_CLIPS = 20;

	// Mirrors the server's z.string().max(500) in
	// /api/shadowing/chunks/flag/+server.ts (and the drill's own cap), so
	// typing past it can't produce a generic 400 that loses the note.
	const FLAG_NOTE_MAX_LENGTH = 500;

	// The slow-down toggle's rate; normal speed is 1.
	const SLOW_RATE = 0.75;

	let { username, onExit }: { username: string; onExit: () => void } = $props();

	let phase = $state<Phase>('idle');
	let errorMessage = $state('');
	let repeats = $state(DEFAULT_RADIO_REPEATS);
	// The 0.75x toggle. Lives for the whole radio session — unlike the drill,
	// where speed resets per clip, radio has no Next, so a listener who slowed
	// it down wants every following clip slow too. Like the repeats stepper,
	// it also survives Stop/Start while the activity stays open.
	let slow = $state(false);

	let playlist = $state<string[]>([]);
	let pos = $state<RadioPosition>(startPosition());
	let currentClip = $state<RadioClip | undefined>();
	// The user's pause intent (also set when the OS pauses us, e.g. headphones
	// unplugged). Checked by the code that would otherwise start the next
	// play, so a pause that lands while a clip is still loading sticks.
	let paused = $state(false);
	// Set when an action fails after radio had started. Shown as a Retry
	// button; null/undefined when there's nothing to retry.
	let retryAction = $state<Action | undefined>();

	// The flag form (see openFlag). While it's open playback is paused.
	let flagging = $state(false);
	let flagNote = $state('');
	let isSubmittingFlag = $state(false);
	let flagInput: HTMLInputElement | undefined = $state();

	let audioEl: HTMLAudioElement | undefined = $state();

	// Not rendered, so plain variables.
	//
	// Bumped on every start and stop. Every async step captures the value it
	// started under and bails out if it's changed — a Stop (or unmount) while
	// a fetch is in flight must not let that fetch go on to start playback.
	let runId = 0;
	// The clip the open flag form will flag, and whether opening it is what
	// paused playback (so Cancel knows whether to resume).
	let flagTarget: RadioClip | undefined;
	let pausedForFlag = false;
	let gapTimer: ReturnType<typeof setTimeout> | undefined;
	// True from a clip ending until the next play begins loading, so a pause
	// during the gap can resume into the gap rather than replaying the clip.
	let gapPending = false;
	// True while an action is fetching/pointing the audio element somewhere,
	// so Resume knows the loader will start playback itself.
	let loading = false;
	// What a failure should retry from; see runAction(). Advancing commits
	// the new position before loading its audio, so a failure after that
	// point must retry the *load*, not advance a second time.
	let retryTarget: Action | undefined;
	// URLs for the current clip and the next, kept only that long: a pass
	// can outlast a signed URL's TTL, so older entries must never be reused.
	// Deliberately a plain Map: it's never rendered, so reactivity would be
	// pure overhead.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	let clipCache = new Map<string, RadioClip>();
	// Held only to keep the browser's download of the next clip alive.
	let prefetchedAudio: HTMLAudioElement | undefined;

	let clipLengthLabel = $derived(
		currentClip ? `${(currentClip.durationMs / 1000).toFixed(1)}s` : ''
	);

	function clearGap() {
		if (gapTimer !== undefined) {
			clearTimeout(gapTimer);
			gapTimer = undefined;
		}
	}

	/** Cancels everything in flight and silences the audio element. Safe to call at any time, including on unmount. */
	function teardown() {
		runId += 1;
		clearGap();
		gapPending = false;
		loading = false;
		retryTarget = undefined;
		retryAction = undefined;
		clipCache.clear();
		prefetchedAudio = undefined;
		if (audioEl) {
			audioEl.pause();
			audioEl.removeAttribute('src');
			audioEl.load();
		}
	}

	function stop() {
		teardown();
		phase = 'idle';
		paused = false;
		flagging = false;
		flagNote = '';
		flagTarget = undefined;
		pausedForFlag = false;
		isSubmittingFlag = false;
		errorMessage = '';
		playlist = [];
		currentClip = undefined;
		pos = startPosition();
	}

	// Component unmounting (e.g. "Back to activities") must stop the audio
	// and any pending timer — a radio that keeps playing with no UI is the
	// worst failure mode this activity has.
	$effect(() => teardown);

	function isUnlockClip(): boolean {
		return !!audioEl && audioEl.currentSrc.endsWith(UNLOCK_SRC);
	}

	/**
	 * Runs one step of the radio under the current run, turning a failure
	 * into an error message plus a Retry that re-runs the step it failed in.
	 */
	async function runAction(action: Action) {
		const run = runId;
		errorMessage = '';
		retryAction = undefined;
		retryTarget = action;
		loading = true;
		try {
			await action(run);
		} catch (e) {
			if (run !== runId) return;
			errorMessage = e instanceof Error ? e.message : String(e);
			if (phase === 'starting') {
				// Nothing is playing yet — back to the start screen, like the drill.
				phase = 'idle';
			} else {
				retryAction = retryTarget;
			}
		} finally {
			if (run === runId) loading = false;
		}
	}

	/** (Re)fetches the whole playlist and rewinds to its start. Returns false if radio should not continue. */
	async function beginCycle(run: number): Promise<boolean> {
		const data = await apiPost<{ chunkIds: string[] }>('/api/shadowing/radio/playlist', {});
		if (run !== runId) return false;
		// Fresh URLs for each pass, even if the same clip comes first again.
		clipCache.clear();
		playlist = data.chunkIds;
		pos = startPosition();
		if (playlist.length === 0) {
			teardown();
			phase = 'no-content';
			return false;
		}
		return true;
	}

	/** Makes sure the cache holds a signed URL for each id, in one request for whichever are missing. */
	async function ensureClips(ids: string[], run: number) {
		const missing = ids.filter((id) => !clipCache.has(id));
		if (missing.length === 0) return;
		const data = await apiPost<{ clips: RadioClip[] }>('/api/shadowing/radio/clips', {
			chunkIds: missing
		});
		if (run !== runId) return;
		for (const clip of data.clips) clipCache.set(clip.chunkId, clip);
	}

	/** Starts audio playback of whatever the element is currently pointed at, unless the user has paused. */
	function playAudio() {
		if (!audioEl || paused) return;
		audioEl.play().catch((e: unknown) => {
			// An interrupted play (a pause, or the source changing underneath
			// it) rejects with AbortError — expected, not a failure.
			if (e instanceof DOMException && e.name === 'AbortError') return;
			showPlaybackFailure();
		});
	}

	/** Re-signs the current clip's URL and plays it from the start. Also what Retry does after a playback error. */
	const reloadCurrentClip: Action = async (run) => {
		if (currentClip) clipCache.delete(currentClip.chunkId);
		await playCurrentClip(run);
	};

	/**
	 * Best effort: gets the next clip's signed URL (and starts its download)
	 * ready while this one plays. Never throws and never blocks playback — if
	 * it fails, advancing to that clip simply does its own load and surfaces
	 * any real failure there, with a Retry.
	 */
	async function prefetchNextClip(run: number) {
		const upcoming = playlist[pos.index + 1];
		if (!upcoming) {
			prefetchedAudio = undefined;
			return;
		}
		try {
			await ensureClips([upcoming], run);
		} catch {
			return;
		}
		const clip = clipCache.get(upcoming);
		// Skip if stopped, or if radio has moved on while this was in flight.
		if (run !== runId || !clip || playlist[pos.index + 1] !== upcoming) return;
		prefetchedAudio = new Audio(clip.audioUrl);
		prefetchedAudio.preload = 'auto';
	}

	function showPlaybackFailure() {
		if (phase !== 'playing') return;
		clearGap();
		gapPending = false;
		errorMessage = 'Playback failed — tap Retry.';
		retryAction = reloadCurrentClip;
	}

	/**
	 * Loads the clip at `pos` (fetching its signed URL), points the audio
	 * element at it, and plays; the next clip is then prefetched in the
	 * background (see prefetchNextClip).
	 *
	 * A clip the server no longer serves (flagged elsewhere since the
	 * playlist was fetched) is dropped from the playlist and the next one is
	 * tried. Running off the end that way starts a fresh pass.
	 */
	const playCurrentClip: Action = async (run) => {
		retryTarget = playCurrentClip;
		// Not the previous clip's length badge while this one is loading.
		currentClip = undefined;
		let skipped = 0;
		for (;;) {
			if (pos.index >= playlist.length) {
				if (!(await beginCycle(run))) return;
				continue;
			}
			const id = playlist[pos.index];
			// Only this clip's URL gates playback; the next one is prefetched
			// afterwards, so a slow or failed prefetch can't hold it up.
			await ensureClips([id], run);
			if (run !== runId) return;
			const clip = clipCache.get(id);
			if (clip) {
				currentClip = clip;
				break;
			}
			skipped += 1;
			if (skipped > MAX_SKIPPED_CLIPS) throw new Error('Could not load audio.');
			playlist = playlist.filter((_, i) => i !== pos.index);
			pos = { index: pos.index, play: 1 };
		}

		const upcoming = playlist[pos.index + 1];
		for (const id of [...clipCache.keys()]) {
			if (id !== currentClip!.chunkId && id !== upcoming) clipCache.delete(id);
		}

		if (!audioEl) return;
		audioEl.src = currentClip!.audioUrl;
		applyPlaybackRate();
		playAudio();
		void prefetchNextClip(run);
	};

	/** Called once a play has finished (after the gap): the next play of this clip, the next clip, or a new pass. */
	const advance: Action = async (run) => {
		gapPending = false;
		const step = nextPosition(pos, playlist.length, repeats);
		if (step.cycleEnded) {
			// Nothing is "current" while the next pass's playlist is fetched.
			// This also disables Flag for that window, so a flag can't start a
			// second loader alongside this one.
			currentClip = undefined;
			if (!(await beginCycle(run))) return;
			await playCurrentClip(run);
			return;
		}
		const sameClip = step.pos.index === pos.index;
		pos = step.pos;
		if (sameClip) {
			// A repeat: same URL, no network.
			if (audioEl) audioEl.currentTime = 0;
			playAudio();
			return;
		}
		await playCurrentClip(run);
	};

	function startGap() {
		clearGap();
		gapTimer = setTimeout(() => {
			gapTimer = undefined;
			void runAction(advance);
		}, GAP_MS);
	}

	function handleEnded() {
		if (phase !== 'playing' || isUnlockClip()) return;
		gapPending = true;
		if (!paused) startGap();
	}

	function handleAudioError() {
		if (phase !== 'playing' || isUnlockClip()) return;
		showPlaybackFailure();
	}

	// Keeps `paused` honest when playback is paused or resumed from outside
	// our own button (a phone call, headphones unplugged, lock-screen
	// controls). "pause" also fires just before "ended" when a clip finishes
	// naturally, hence the ended check.
	function handlePause() {
		if (phase !== 'playing' || !audioEl || audioEl.ended || isUnlockClip()) return;
		paused = true;
	}

	function handlePlay() {
		if (phase !== 'playing' || isUnlockClip()) return;
		paused = false;
	}

	/**
	 * Applies the speed toggle to the audio element. `defaultPlaybackRate` is
	 * set as well as `playbackRate` because loading a new `src` resets
	 * `playbackRate` to the default — that reset is what would otherwise
	 * drop every clip after the first back to normal speed.
	 */
	function applyPlaybackRate() {
		if (!audioEl) return;
		const rate = slow ? SLOW_RATE : 1;
		audioEl.defaultPlaybackRate = rate;
		audioEl.playbackRate = rate;
		// Keeps pitch natural at 0.75x instead of dropping it. preservesPitch
		// is the standard name; the webkit-prefixed one covers older Safari.
		audioEl.preservesPitch = true;
		(audioEl as HTMLAudioElement & { webkitPreservesPitch?: boolean }).webkitPreservesPitch = true;
	}

	function toggleSpeed() {
		slow = !slow;
		applyPlaybackRate();
	}

	function pausePlayback() {
		if (!audioEl) return;
		paused = true;
		// Mid-gap: stop the countdown but remember a clip had finished.
		clearGap();
		audioEl.pause();
	}

	function resumePlayback() {
		if (!audioEl) return;
		paused = false;
		if (gapPending) {
			startGap();
		} else if (!loading) {
			audioEl.play().catch((e: unknown) => {
				if (e instanceof DOMException && e.name === 'AbortError') return;
				showPlaybackFailure();
			});
		}
		// else: an action is mid-load and will start playback itself now that
		// `paused` is false again.
	}

	function togglePause() {
		if (phase !== 'playing') return;
		if (paused) resumePlayback();
		else pausePlayback();
	}

	/**
	 * Opens the flag form for the clip that's current right now, and pauses
	 * playback while it's open — otherwise the clips would keep cycling
	 * under the note being typed. The clip is captured here, not read at
	 * confirm time, so the note can only ever land on the clip that was
	 * flagged. Cancel resumes only if this is what paused it.
	 */
	function openFlag() {
		if (!currentClip || flagging) return;
		flagTarget = currentClip;
		flagNote = '';
		errorMessage = '';
		pausedForFlag = !paused;
		if (pausedForFlag) pausePlayback();
		flagging = true;
		// Opening the form disables the Flag button that was just pressed, so
		// keyboard focus would otherwise fall back to the page body.
		void tick().then(() => flagInput?.focus());
	}

	function cancelFlag() {
		if (isSubmittingFlag) return;
		flagging = false;
		flagTarget = undefined;
		errorMessage = '';
		// Not while a failure is showing: there's nothing to resume, and
		// Retry is the way forward.
		if (pausedForFlag && !retryAction) resumePlayback();
	}

	/**
	 * Flags the captured clip (excluding it from every future pass, here and
	 * in the drill) and moves on to whatever now sits at its position.
	 */
	async function confirmFlag() {
		const target = flagTarget;
		if (!target || isSubmittingFlag) return;
		const run = runId;
		isSubmittingFlag = true;
		errorMessage = '';
		try {
			await apiPost('/api/shadowing/chunks/flag', {
				chunkId: target.chunkId,
				note: flagNote.trim() || undefined
			});
		} catch (e) {
			// Radio was stopped while the request was in flight: stop() already
			// reset the form, and a newer form (if any) isn't ours to touch.
			if (run !== runId) return;
			// Stays on the form, note intact, so the same press can retry.
			errorMessage = e instanceof Error ? e.message : String(e);
			isSubmittingFlag = false;
			return;
		}
		// Same, on success: the flag is saved, but there's nothing to continue.
		if (run !== runId) return;
		isSubmittingFlag = false;

		flagging = false;
		flagTarget = undefined;
		// Playback has been paused since the form opened, so the flagged clip
		// is still the one at `pos` — removing it leaves that index pointing
		// at whatever slid into its slot (or past the end, if it was last,
		// which makes playCurrentClip start a fresh pass).
		playlist = playlist.filter((id) => id !== target.chunkId);
		clipCache.delete(target.chunkId);
		// The next clip starts from its first play. Stays paused only if the
		// user had paused before opening the form.
		gapPending = false;
		pos = { index: pos.index, play: 1 };
		if (pausedForFlag) paused = false;
		void runAction(playCurrentClip);
	}

	function retry() {
		if (!retryAction) return;
		// Retry is itself a tap, and the likeliest reason for a failure on a
		// phone is a play() the browser refused outside a gesture — so
		// re-unlock here, synchronously, before the action's awaits. The
		// silent clip's events are ignored and the action overwrites `src`.
		unlockAudio();
		paused = false;
		void runAction(retryAction);
	}

	/**
	 * Mobile browsers (iOS Safari especially) only let a media element start
	 * playing from inside a user gesture, and everything radio plays after
	 * the first tap happens later, after network fetches and timers. Playing
	 * a short silent clip synchronously inside the Start tap marks the
	 * element as user-activated, which is what lets the later programmatic
	 * src changes and play() calls through. (Reusing this one element for
	 * every clip is deliberate for the same reason.)
	 */
	function unlockAudio() {
		if (!audioEl) return;
		audioEl.src = UNLOCK_SRC;
		audioEl.play().catch(() => {
			// Best effort — if this is blocked, the first real play() will
			// surface the failure with a Retry.
		});
	}

	function start() {
		if (phase === 'starting' || phase === 'playing') return;
		// Synchronous, before any await: this must run inside the tap.
		unlockAudio();
		runId += 1;
		phase = 'starting';
		paused = false;
		void runAction(async (run) => {
			if (!(await beginCycle(run))) return;
			phase = 'playing';
			await playCurrentClip(run);
		});
	}
</script>

<!-- Always mounted, so the element exists (and can be unlocked) during the
     Start tap itself. Hidden: radio has no seek bar. -->
<audio
	bind:this={audioEl}
	preload="auto"
	onended={handleEnded}
	onerror={handleAudioError}
	onpause={handlePause}
	onplay={handlePlay}
	style="display: none"
></audio>

{#snippet repeatsControl()}
	<div class="radio-repeats">
		<span id="radio-repeats-label">Plays per clip</span>
		<button
			aria-label="Fewer plays per clip"
			disabled={repeats <= MIN_RADIO_REPEATS}
			onclick={() => (repeats = clampRepeats(repeats - 1))}>−</button
		>
		<output aria-labelledby="radio-repeats-label">{repeats}</output>
		<button
			aria-label="More plays per clip"
			disabled={repeats >= MAX_RADIO_REPEATS}
			onclick={() => (repeats = clampRepeats(repeats + 1))}>+</button
		>
	</div>
{/snippet}

{#if phase === 'idle' || phase === 'starting'}
	<p class="subtitle">{username}</p>
	{@render repeatsControl()}
	<button class="button-primary" onclick={start} disabled={phase === 'starting'}>
		{#if phase === 'starting'}<span class="spinner" aria-hidden="true"></span>{/if}
		{phase === 'starting' ? 'Starting…' : 'Start radio'}
	</button>
	<p class="cancel"><button onclick={onExit}>Back to activities</button></p>
{:else if phase === 'no-content'}
	<p>
		No shadowing content available yet — nothing has been ingested for this account, or every clip
		has been flagged.
	</p>
	<p class="cancel"><button onclick={onExit}>Back to activities</button></p>
{:else}
	<div class="word-block">
		<!-- Not role="status": this changes every few seconds, which a screen
		     reader would announce each time. -->
		<div class="cell-header">
			<!-- Clamped: right after the last clip is flagged, pos is briefly one
			     past the shortened list, until the next pass loads. -->
			<span class="badge">Clip {Math.min(pos.index + 1, playlist.length)} / {playlist.length}</span>
			<span class="badge">Play {Math.min(pos.play, repeats)} / {repeats}</span>
			{#if clipLengthLabel}<span class="badge">{clipLengthLabel}</span>{/if}
		</div>
		<div class="shadowing-controls">
			<!-- Disabled while a failure is showing: there's nothing playing to
			     pause or resume, and Retry (below) is the way forward. -->
			<button
				class="shadowing-play-button"
				onclick={togglePause}
				disabled={!!retryAction || flagging}
			>
				{paused ? '▶ Resume' : '⏸ Pause'}
			</button>
			<div class="shadowing-secondary-controls">
				<button class:active={slow} aria-pressed={slow} onclick={toggleSpeed}>0.75×</button>
				<!-- Needs a loaded clip to flag. Still available while a playback
				     error is showing — a clip that won't play is a fair one to flag. -->
				<button onclick={openFlag} disabled={!currentClip || flagging}>⚑ Flag</button>
			</div>
		</div>
	</div>

	{#if flagging}
		<div class="interaction__actions">
			<label class="field">
				<span>Note (optional):</span>
				<input
					type="text"
					bind:this={flagInput}
					bind:value={flagNote}
					disabled={isSubmittingFlag}
					maxlength={FLAG_NOTE_MAX_LENGTH}
					onkeydown={(e) => e.key === 'Enter' && confirmFlag()}
				/>
			</label>
			<button class="button-primary" onclick={confirmFlag} disabled={isSubmittingFlag}
				>Flag and continue</button
			>
			<p class="cancel">
				<button onclick={cancelFlag} disabled={isSubmittingFlag}>Cancel</button>
			</p>
		</div>
	{:else}
		{@render repeatsControl()}

		{#if retryAction}
			<button class="button-primary" onclick={retry}>Retry</button>
		{/if}
		<p class="cancel"><button onclick={stop}>Stop radio</button></p>
	{/if}
{/if}

{#if errorMessage}
	<p class="error">{errorMessage}</p>
{/if}
