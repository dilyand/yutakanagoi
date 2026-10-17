import { validateCard } from './validate-card';
import { TARGET_TYPES } from './types';
import type { SessionState } from './session';

/**
 * Serializing a session to / from localStorage (design doc §8). Pure: the
 * storage access itself lives in the client, wrapped in try/catch. A snapshot
 * that is stale, from another version, for another user, or malformed is
 * simply not offered.
 */

export const SNAPSHOT_VERSION = 1;
/** How long a session stays resumable. */
export const SNAPSHOT_TTL_MS = 3 * 60 * 60 * 1000;

export interface Snapshot {
	v: typeof SNAPSHOT_VERSION;
	userId: number;
	savedAt: number;
	state: SessionState;
}

export function toSnapshot(state: SessionState, userId: number, now = Date.now()): string {
	const snapshot: Snapshot = { v: SNAPSHOT_VERSION, userId, savedAt: now, state };
	return JSON.stringify(snapshot);
}

function isRec(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Parses a stored snapshot, or returns null. The card is re-validated (it is
 * about to be sent to the server again); items are trusted as the learner's own
 * data, but their container shapes are checked so a corrupt entry can't crash
 * the runner.
 */
export function parseSnapshot(
	raw: string | null,
	userId: number,
	now = Date.now()
): SessionState | null {
	if (!raw) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!isRec(parsed) || parsed.v !== SNAPSHOT_VERSION || parsed.userId !== userId) return null;
	if (typeof parsed.savedAt !== 'number' || now - parsed.savedAt > SNAPSHOT_TTL_MS) return null;
	const state = parsed.state;
	if (!isRec(state) || state.v !== 1) return null;

	const cardType = isRec(state.card) ? state.card.type : undefined;
	const type = TARGET_TYPES.find((t) => t === cardType);
	if (!type || validateCard(state.card, type).status !== 'ok') return null;

	for (const key of ['stage1', 'stage2'] as const) {
		const slot = state[key];
		if (!isRec(slot) || !Array.isArray(slot.items) || !Array.isArray(slot.failedPhases))
			return null;
	}
	if (!Array.isArray(state.queue) || !Array.isArray(state.results)) return null;
	if (!Array.isArray(state.usedSentences)) return null;
	if (typeof state.pos !== 'number' || typeof state.phaseIdx !== 'number') return null;
	return state as unknown as SessionState;
}

/** A session worth offering to resume: it has started, or is waiting on its stages. */
export function isResumable(state: SessionState): boolean {
	return state.at !== 'done';
}
