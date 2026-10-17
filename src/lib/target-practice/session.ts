import { failedPhases, mergeStages, validateStage } from './generation';
import type { GenerateOk, GenerationStage } from './generation';
import { skeletonFor } from './skeleton';
import type { Card, Item, PhaseId } from './types';

/**
 * Session state for the running target-practice activity (design doc §8, and
 * the "Slice 5 decisions" in §14). Plain JSON on purpose: the same object is
 * the localStorage snapshot, and every function here takes a state and
 * returns a new one, so the whole flow — two parallel stages arriving in
 * either order, retries that keep only the failed phases, spare re-queueing,
 * scoring — is unit-testable without a browser. The Svelte components only
 * call these and render what they say.
 */

/** At most this many spares are re-queued after misses in one session (§7). */
export const MAX_REQUEUES = 6;
/** A re-queued spare comes this many items after the miss (or at the phase end). */
export const REQUEUE_OFFSET = 2;
/** The generate route accepts at most this many `avoid` sentences, each ≤ 200 characters. */
export const MAX_AVOID_SENTENCES = 40;
const MAX_AVOID_LENGTH = 200;

export type SlotStatus = 'pending' | 'ready' | 'failed';

/** One generation stage's progress. */
export interface StageSlot {
	/** `pending`: the first request is in flight. `failed`: it failed and nothing was delivered. */
	status: SlotStatus;
	/** Validated items, primaries and spares. Stage 2's are only playable once `merged`. */
	items: Item[];
	/** Phases of this stage that came back below their minimum. */
	failedPhases: PhaseId[];
	/** A retry request is in flight (the stage's other phases stay playable). */
	retrying: boolean;
	/** The one automatic retry has been used. */
	retried: boolean;
	/** A cap/kill-switch hit: retrying cannot help, so none is offered. */
	blocked: boolean;
	/** Why the stage is failed or blocked, for the learner. */
	message: string;
	/** Stage 2 only: `mergeStages` has run against stage 1. */
	merged: boolean;
}

export type Outcome = 'correct' | 'wrong' | 'neutral';

export interface ItemResult {
	itemId: string;
	phase: PhaseId;
	outcome: Outcome;
	/** 1, or 2 when the hint ladder was used. */
	attempts: 1 | 2;
	/** The learner's last answer (a label for tiles and mc), shown in the wrap-up. */
	answer: string;
	/** A re-queued spare: extra practice, not scored. */
	extra: boolean;
}

/** What the item views report when an item is finished. */
export interface ResultInput {
	outcome: Outcome;
	attempts: 1 | 2;
	answer: string;
}

export type Position = 'not_started' | 'item' | 'boundary' | 'done';

export interface SessionState {
	v: 1;
	round: number;
	card: Card;
	stage1: StageSlot;
	stage2: StageSlot;
	/** Sentences from earlier rounds, so "Another round" doesn't repeat them. */
	usedSentences: string[];
	at: Position;
	/** Index into the skeleton of the phase being played, or just completed at a boundary. */
	phaseIdx: number;
	/** Item ids of the current phase, in order; re-queued spares are inserted. */
	queue: string[];
	pos: number;
	requeues: number;
	results: ItemResult[];
	finishedEarly: boolean;
}

function emptySlot(): StageSlot {
	return {
		status: 'pending',
		items: [],
		failedPhases: [],
		retrying: false,
		retried: false,
		blocked: false,
		message: '',
		merged: false
	};
}

export function newSession(card: Card, usedSentences: string[] = [], round = 1): SessionState {
	return {
		v: 1,
		round,
		card,
		stage1: emptySlot(),
		stage2: emptySlot(),
		usedSentences,
		at: 'not_started',
		phaseIdx: 0,
		queue: [],
		pos: 0,
		requeues: 0,
		results: [],
		finishedEarly: false
	};
}

// --- Lookups ---------------------------------------------------------------

export function slotOf(state: SessionState, stage: GenerationStage): StageSlot {
	return stage === 1 ? state.stage1 : state.stage2;
}

function withSlot(state: SessionState, stage: GenerationStage, slot: StageSlot): SessionState {
	return stage === 1 ? { ...state, stage1: slot } : { ...state, stage2: slot };
}

export function phases(state: SessionState) {
	return skeletonFor(state.card);
}

/** Every playable item (both stages; stage 2 only once merged), spares included. */
export function playableItems(state: SessionState): Item[] {
	return [...state.stage1.items, ...(state.stage2.merged ? state.stage2.items : [])];
}

export function findItem(state: SessionState, id: string): Item | undefined {
	return playableItems(state).find((i) => i.id === id);
}

function primariesIn(state: SessionState, phase: PhaseId): Item[] {
	return playableItems(state).filter((i) => i.phase === phase && !i.spare);
}

export type PhaseStatus = 'ready' | 'waiting' | 'failed';

/**
 * Whether a phase can be played now. `ready` needs at least the phase's minimum
 * of primaries and no failed-phase mark; otherwise `waiting` while a request
 * for its stage is still in flight (or stage 2 is waiting to be merged), else `failed`.
 */
export function phaseStatus(state: SessionState, phaseId: PhaseId): PhaseStatus {
	const spec = phases(state).find((p) => p.id === phaseId);
	if (!spec) return 'failed';
	const slot = slotOf(state, spec.stage);
	if (primariesIn(state, phaseId).length >= spec.min && !slot.failedPhases.includes(phaseId)) {
		return 'ready';
	}
	if (slot.status === 'pending' || slot.retrying) return 'waiting';
	if (
		spec.stage === 2 &&
		!slot.merged &&
		slot.status === 'ready' &&
		state.stage1.status !== 'failed'
	) {
		return 'waiting';
	}
	return 'failed';
}

/** "Start" enables once the first phase is playable (decision 5). */
export function canStart(state: SessionState): boolean {
	const first = phases(state)[0];
	return state.at === 'not_started' && phaseStatus(state, first.id) === 'ready';
}

// --- Stage results ---------------------------------------------------------

/** Merges stage 2 against stage 1 once both are in (decision: cross-stage dedupe lives here). */
function tryMerge(state: SessionState): SessionState {
	const { stage1, stage2 } = state;
	if (stage1.status !== 'ready' || stage2.status !== 'ready' || stage2.merged) return state;
	const merged = mergeStages(state.card, stage1.items, stage2.items);
	const items = merged.items.slice(stage1.items.length);
	return {
		...state,
		stage2: { ...stage2, items, merged: true, failedPhases: failedPhases(merged.setIssues) }
	};
}

/**
 * A stage response arrived — the first one, or a retry. A retry re-requests the
 * whole stage but keeps ONLY the failed phases from the response (decision 3),
 * so phases the learner may already have played are not duplicated; the result
 * is re-validated so the failed-phase list is recomputed rather than assumed.
 */
export function applyStageResult(
	state: SessionState,
	stage: GenerationStage,
	response: GenerateOk
): SessionState {
	const slot = slotOf(state, stage);
	const stagePhases = phases(state)
		.filter((p) => p.stage === stage)
		.map((p) => p.id);

	if (slot.status === 'pending') {
		const next: StageSlot = {
			...slot,
			status: 'ready',
			retrying: false,
			message: '',
			items: response.items,
			failedPhases: failedPhases(response.setIssues),
			merged: false
		};
		return tryMerge(withSlot(state, stage, next));
	}

	// A retry: replace only the phases that were failed (all of them if the request failed).
	const redo = slot.status === 'failed' ? stagePhases : slot.failedPhases;
	const combined = [
		...(slot.status === 'failed' ? [] : slot.items.filter((i) => !redo.includes(i.phase))),
		...response.items.filter((i) => redo.includes(i.phase))
	];

	if (stage === 1) {
		const checked = validateStage(state.card, combined, { stage: 1 });
		return tryMerge(
			withSlot(state, 1, {
				...slot,
				status: 'ready',
				retrying: false,
				message: '',
				items: checked.valid,
				failedPhases: failedPhases(checked.setIssues)
			})
		);
	}

	if (state.stage1.status === 'ready' && (slot.merged || slot.status === 'failed')) {
		const merged = mergeStages(state.card, state.stage1.items, combined);
		return withSlot(state, 2, {
			...slot,
			status: 'ready',
			retrying: false,
			message: '',
			merged: true,
			items: merged.items.slice(state.stage1.items.length),
			failedPhases: failedPhases(merged.setIssues)
		});
	}
	// Stage 1 isn't usable yet: keep the combined items unmerged until it is.
	return tryMerge(
		withSlot(state, 2, {
			...slot,
			status: 'ready',
			retrying: false,
			message: '',
			merged: false,
			items: combined,
			failedPhases: []
		})
	);
}

/** A stage request failed (network, 502) or was blocked by the cap / kill switch. */
export function applyStageFailure(
	state: SessionState,
	stage: GenerationStage,
	message: string,
	blocked = false
): SessionState {
	const slot = slotOf(state, stage);
	return withSlot(state, stage, {
		...slot,
		// A stage that delivered something before keeps it; only a first request that never did is "failed".
		status: slot.status === 'pending' ? 'failed' : slot.status,
		retrying: false,
		blocked,
		message
	});
}

/** The stage's retry has started (automatic or manual). */
export function beginRetry(state: SessionState, stage: GenerationStage): SessionState {
	const slot = slotOf(state, stage);
	return withSlot(state, stage, {
		...slot,
		retrying: true,
		retried: true,
		blocked: false,
		message: ''
	});
}

/**
 * What to do about a stage that is short: `auto` retries once without asking,
 * `manual` offers the Retry button, `none` when the stage is fine, a retry is
 * running, or the failure was a cap hit.
 */
export function retryAction(
	state: SessionState,
	stage: GenerationStage
): 'auto' | 'manual' | 'none' {
	const slot = slotOf(state, stage);
	if (slot.retrying || slot.status === 'pending' || slot.blocked) return 'none';
	// Stage 2 failed phases are only known after the merge.
	if (stage === 2 && slot.status === 'ready' && !slot.merged) return 'none';
	const short = slot.status === 'failed' || slot.failedPhases.length > 0;
	if (!short) return 'none';
	return slot.retried ? 'manual' : 'auto';
}

// --- Playing ---------------------------------------------------------------

function enterPhase(state: SessionState, phaseIdx: number): SessionState {
	const phase = phases(state)[phaseIdx].id;
	return {
		...state,
		at: 'item',
		phaseIdx,
		queue: primariesIn(state, phase).map((i) => i.id),
		pos: 0
	};
}

export function start(state: SessionState): SessionState {
	return canStart(state) ? enterPhase(state, 0) : state;
}

export function currentItem(state: SessionState): Item | undefined {
	return state.at === 'item' ? findItem(state, state.queue[state.pos]) : undefined;
}

export function currentPhaseId(state: SessionState): PhaseId {
	return phases(state)[state.phaseIdx].id;
}

/** The phase after the one just completed, with whether it can be played yet. */
export function nextPhaseInfo(state: SessionState): { phase: PhaseId; status: PhaseStatus } | null {
	const next = phases(state)[state.phaseIdx + 1];
	return next ? { phase: next.id, status: phaseStatus(state, next.id) } : null;
}

/** From a phase boundary, play the next phase if it is ready; otherwise nothing changes. */
export function continueFromBoundary(state: SessionState): SessionState {
	if (state.at !== 'boundary') return state;
	const next = nextPhaseInfo(state);
	if (!next || next.status !== 'ready') return state;
	return enterPhase(state, state.phaseIdx + 1);
}

export function finishHere(state: SessionState): SessionState {
	return { ...state, at: 'done', finishedEarly: true };
}

function pickSpare(state: SessionState, missed: Item): Item | undefined {
	const used = new Set(state.queue);
	for (const r of state.results) used.add(r.itemId);
	const spares = playableItems(state).filter(
		(i) => i.spare === true && i.phase === missed.phase && !used.has(i.id)
	);
	const sameShape = (i: Item) =>
		i.kind === missed.kind && (i.kind !== 'claude' || i.free === (missed as typeof i).free);
	return spares.find(sameShape) ?? spares.find((i) => i.kind === missed.kind) ?? spares[0];
}

/**
 * Records the current item's result and moves on: re-queues a spare after a
 * miss (never for a spare itself, never past the cap), then advances to the
 * next item, the phase boundary, or the end.
 */
export function recordResult(state: SessionState, result: ResultInput): SessionState {
	const item = currentItem(state);
	if (!item) return state;
	const extra = item.spare === true;
	const results = [
		...state.results,
		{ itemId: item.id, phase: item.phase, ...result, extra } satisfies ItemResult
	];

	let queue = state.queue;
	let requeues = state.requeues;
	if (result.outcome === 'wrong' && !extra && requeues < MAX_REQUEUES) {
		const spare = pickSpare(state, item);
		if (spare) {
			const at = Math.min(state.pos + 1 + REQUEUE_OFFSET, queue.length);
			queue = [...queue.slice(0, at), spare.id, ...queue.slice(at)];
			requeues += 1;
		}
	}

	const pos = state.pos + 1;
	const base = { ...state, results, queue, requeues, pos };
	if (pos < queue.length) return base;
	return { ...base, at: state.phaseIdx >= phases(state).length - 1 ? 'done' : 'boundary' };
}

// --- Wrap-up ---------------------------------------------------------------

export interface PhaseScore {
	phase: PhaseId;
	correct: number;
	wrong: number;
	neutral: number;
}

/** Per played phase, over primaries only (re-queued spares are extra practice). */
export function phaseScores(state: SessionState): PhaseScore[] {
	return phases(state).flatMap((p) => {
		const rs = state.results.filter((r) => r.phase === p.id && !r.extra);
		if (rs.length === 0) return [];
		return [
			{
				phase: p.id,
				correct: rs.filter((r) => r.outcome === 'correct').length,
				wrong: rs.filter((r) => r.outcome === 'wrong').length,
				neutral: rs.filter((r) => r.outcome === 'neutral').length
			}
		];
	});
}

export interface MissedItem {
	item: Item;
	answer: string;
	extra: boolean;
}

/** Every miss, with what the learner answered; the wrap-up shows the key and rationale. */
export function missedItems(state: SessionState): MissedItem[] {
	return state.results.flatMap((r) => {
		if (r.outcome !== 'wrong') return [];
		const item = findItem(state, r.itemId);
		return item ? [{ item, answer: r.answer, extra: r.extra }] : [];
	});
}

// --- Rounds and avoid lists ------------------------------------------------

/** Sentences an item shows (a tiles item contributes its first accepted sentence). */
export function sentencesOf(items: Item[]): string[] {
	return items.flatMap((i) =>
		i.kind === 'tiles' ? i.accepted.slice(0, 1) : i.sentence ? [i.sentence] : []
	);
}

function capAvoid(sentences: string[]): string[] {
	const usable = [...new Set(sentences)].filter((s) => s.length <= MAX_AVOID_LENGTH);
	return usable.slice(-MAX_AVOID_SENTENCES);
}

/** `avoid` for a request: earlier rounds plus whatever this round already has. */
export function avoidFor(state: SessionState): string[] {
	return capAvoid([...state.usedSentences, ...sentencesOf(playableItems(state))]);
}

/** "Another round": same card, fresh stages, told what was already used. */
export function nextRound(state: SessionState): SessionState {
	return newSession(state.card, avoidFor(state), state.round + 1);
}
