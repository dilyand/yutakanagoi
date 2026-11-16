import { isResumable, parseSnapshot, toSnapshot } from '$lib/target-practice/snapshot';
import type { SessionState } from '$lib/target-practice/session';

/**
 * localStorage access for the session snapshot (design doc §8). localStorage,
 * not sessionStorage, because a standalone iOS PWA can clear sessionStorage on
 * relaunch. Every access is wrapped in try/catch — storage can be unavailable or
 * throw (private windows, blocked site data) — and the activity works without it.
 */

const PREFIX = 'yutakanagoi:target-practice:session:';
const keyFor = (userId: number) => `${PREFIX}${userId}`;

export function saveSnapshot(state: SessionState, userId: number): void {
	try {
		localStorage.setItem(keyFor(userId), toSnapshot(state, userId));
	} catch {
		// Resume is a convenience; a failed write must never disturb the session.
	}
}

/** The learner's resumable session, if one is stored and still fresh; stale or broken entries are removed. */
export function loadSnapshot(userId: number): SessionState | null {
	try {
		const state = parseSnapshot(localStorage.getItem(keyFor(userId)), userId);
		if (state && isResumable(state)) return state;
		localStorage.removeItem(keyFor(userId));
	} catch {
		// Fall through: nothing to resume.
	}
	return null;
}

export function clearSnapshot(userId: number): void {
	try {
		localStorage.removeItem(keyFor(userId));
	} catch {
		// Nothing to clear.
	}
}

/** Logout: drop every stored snapshot on this device, whichever user it was for. */
export function clearAllSnapshots(): void {
	try {
		const keys: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (key?.startsWith(PREFIX)) keys.push(key);
		}
		for (const key of keys) localStorage.removeItem(key);
	} catch {
		// Nothing to clear.
	}
}
