import { describe, expect, it } from 'vitest';
import { grammarKakadouka } from './fixtures';
import { newSession } from './session';
import { SNAPSHOT_TTL_MS, isResumable, parseSnapshot, toSnapshot } from './snapshot';
import { BUILT_TYPES, GUIDANCE, isBuilt } from './input-guidance';
import { TARGET_TYPES } from './types';
import { validateTargetInput } from './input-validation';

const state = newSession(grammarKakadouka.card);

describe('snapshot', () => {
	it('round-trips for the same user within the TTL', () => {
		const raw = toSnapshot(state, 7, 1_000);
		expect(parseSnapshot(raw, 7, 1_000 + SNAPSHOT_TTL_MS)).toEqual(state);
	});

	it('is not offered when stale, for another user, or malformed', () => {
		const raw = toSnapshot(state, 7, 1_000);
		expect(parseSnapshot(raw, 7, 1_001 + SNAPSHOT_TTL_MS)).toBeNull();
		expect(parseSnapshot(raw, 8, 1_000)).toBeNull();
		expect(parseSnapshot('{nope', 7)).toBeNull();
		expect(parseSnapshot(null, 7)).toBeNull();
		expect(
			parseSnapshot(JSON.stringify({ v: 1, userId: 7, savedAt: 1, state: {} }), 7, 2)
		).toBeNull();
	});

	it('rejects a snapshot whose card no longer validates', () => {
		const bad = JSON.parse(toSnapshot(state, 7, 1_000));
		bad.state.card.rule = '';
		expect(parseSnapshot(JSON.stringify(bad), 7, 1_000)).toBeNull();
	});

	it('a finished session is not resumable', () => {
		expect(isResumable(state)).toBe(true);
		expect(isResumable({ ...state, at: 'done' })).toBe(false);
	});
});

describe('input guidance', () => {
	it('has guidance for every type, and only grammar and word are built', () => {
		for (const t of TARGET_TYPES) expect(GUIDANCE[t].chips.length).toBeGreaterThan(0);
		expect([...BUILT_TYPES]).toEqual(['grammar', 'word']);
		expect(isBuilt('kanji')).toBe(false);
	});

	it('every example chip passes local validation for its type', () => {
		for (const t of TARGET_TYPES) {
			for (const chip of GUIDANCE[t].chips) {
				expect(validateTargetInput(t, chip), `${t}: ${chip}`).toMatchObject({ ok: true });
			}
		}
	});
});
