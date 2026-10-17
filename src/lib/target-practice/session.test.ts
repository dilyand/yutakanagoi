import { describe, expect, it } from 'vitest';
import { grammarKakadouka, wordKibishii } from './fixtures';
import type { Fixture } from './fixtures';
import type { GenerateOk } from './generation';
import {
	MAX_AVOID_SENTENCES,
	MAX_REQUEUES,
	applyStageFailure,
	applyStageResult,
	avoidFor,
	beginRetry,
	canStart,
	continueFromBoundary,
	currentItem,
	finishHere,
	findItem,
	missedItems,
	newSession,
	nextPhaseInfo,
	nextRound,
	phaseScores,
	phaseStatus,
	playableItems,
	recordResult,
	retryAction,
	start
} from './session';
import type { SessionState } from './session';
import { skeletonFor } from './skeleton';
import type { Item, PhaseId } from './types';

const stageOf = (fx: Fixture, phase: PhaseId) =>
	skeletonFor(fx.card).find((p) => p.id === phase)!.stage;
const itemsOfStage = (fx: Fixture, stage: 1 | 2) =>
	fx.items.filter((i) => stageOf(fx, i.phase) === stage);
const ok = (stage: 1 | 2, items: Item[], setIssues: GenerateOk['setIssues'] = []): GenerateOk => ({
	status: 'ok',
	stage,
	items,
	setIssues,
	regenerated: false
});
const spareOf = (item: Item, id: string): Item => ({ ...item, id, spare: true });
const belowMin = (phase: PhaseId) => ({
	code: 'phase_below_minimum' as const,
	phase,
	detail: 'short'
});

/** Both stages in, session started. */
function started(fx: Fixture, extra: Item[] = []): SessionState {
	let s = newSession(fx.card);
	s = applyStageResult(
		s,
		1,
		ok(1, [...itemsOfStage(fx, 1), ...extra.filter((i) => stageOf(fx, i.phase) === 1)])
	);
	s = applyStageResult(
		s,
		2,
		ok(2, [...itemsOfStage(fx, 2), ...extra.filter((i) => stageOf(fx, i.phase) === 2)])
	);
	return start(s);
}

const correct = { outcome: 'correct', attempts: 1, answer: 'x' } as const;
const wrongR = { outcome: 'wrong', attempts: 1, answer: 'x' } as const;

/** Answers every remaining item of the current phase. */
function playPhase(s: SessionState, r: typeof correct | typeof wrongR = correct): SessionState {
	const idx = s.phaseIdx;
	while (s.at === 'item' && s.phaseIdx === idx) s = recordResult(s, r);
	return s;
}

describe('stage arrival', () => {
	it('stage 1 alone makes the first phase playable; stage 2 phases wait', () => {
		let s = newSession(grammarKakadouka.card);
		expect(canStart(s)).toBe(false);
		s = applyStageResult(s, 1, ok(1, itemsOfStage(grammarKakadouka, 1)));
		expect(canStart(s)).toBe(true);
		expect(phaseStatus(s, 'understand')).toBe('ready');
		expect(phaseStatus(s, 'produce')).toBe('waiting');
	});

	it('stage 2 arriving first is held until stage 1 is in, then merged', () => {
		let s = newSession(grammarKakadouka.card);
		s = applyStageResult(s, 2, ok(2, itemsOfStage(grammarKakadouka, 2)));
		expect(phaseStatus(s, 'produce')).toBe('waiting');
		expect(s.stage2.merged).toBe(false);
		s = applyStageResult(s, 1, ok(1, itemsOfStage(grammarKakadouka, 1)));
		expect(s.stage2.merged).toBe(true);
		expect(phaseStatus(s, 'produce')).toBe('ready');
		expect(playableItems(s)).toHaveLength(grammarKakadouka.items.length);
	});

	it('the merge drops a stage-2 sentence that repeats stage 1', () => {
		const dup = itemsOfStage(grammarKakadouka, 2).find((i) => i.kind === 'typed' && i.sentence)!;
		const stage1Dup = {
			...itemsOfStage(grammarKakadouka, 1)[0],
			id: 'dup-s1',
			sentence: dup.sentence
		} as Item;
		let s = newSession(grammarKakadouka.card);
		s = applyStageResult(s, 1, ok(1, [...itemsOfStage(grammarKakadouka, 1), stage1Dup]));
		s = applyStageResult(s, 2, ok(2, itemsOfStage(grammarKakadouka, 2)));
		expect(s.stage2.items.find((i) => i.id === dup.id)).toBeUndefined();
	});

	it('a stage whose request failed has failed phases; a cap hit offers no retry', () => {
		let s = newSession(grammarKakadouka.card);
		s = applyStageResult(s, 1, ok(1, itemsOfStage(grammarKakadouka, 1)));
		s = applyStageFailure(s, 2, 'boom');
		expect(phaseStatus(s, 'produce')).toBe('failed');
		expect(retryAction(s, 2)).toBe('auto');
		s = applyStageFailure(beginRetry(s, 2), 2, 'boom again');
		expect(retryAction(s, 2)).toBe('manual');
		s = applyStageFailure(s, 2, 'Daily limit', true);
		expect(retryAction(s, 2)).toBe('none');
	});

	it('Understand failed in stage 1 blocks Start and asks for a retry', () => {
		const items = itemsOfStage(grammarKakadouka, 1).filter((i) => i.phase !== 'understand');
		let s = newSession(grammarKakadouka.card);
		s = applyStageResult(s, 1, ok(1, items, [belowMin('understand')]));
		expect(canStart(s)).toBe(false);
		expect(retryAction(s, 1)).toBe('auto');
	});
});

describe('retry keeps only the failed phases', () => {
	it('a failed stage-2 phase is refilled while the other phases are left alone', () => {
		const fx = grammarKakadouka;
		const stage2 = itemsOfStage(fx, 2);
		const withoutContrast = stage2.filter((i) => i.phase !== 'contrast');
		let s = newSession(fx.card);
		s = applyStageResult(s, 1, ok(1, itemsOfStage(fx, 1)));
		s = applyStageResult(s, 2, ok(2, withoutContrast, [belowMin('contrast')]));
		expect(s.stage2.failedPhases).toContain('contrast');
		expect(phaseStatus(s, 'contrast')).toBe('failed');

		const producesBefore = s.stage2.items.filter((i) => i.phase === 'produce').map((i) => i.id);
		s = beginRetry(s, 2);
		expect(phaseStatus(s, 'contrast')).toBe('waiting');
		expect(phaseStatus(s, 'produce')).toBe('ready');

		// The retry response is a whole stage: only its Contrast items may be used.
		const fresh = stage2.map((i) => ({
			...i,
			id: `r-${i.id}`,
			sentence: i.sentence && `${i.sentence}!`
		}));
		s = applyStageResult(s, 2, ok(2, fresh as Item[]));
		expect(s.stage2.items.filter((i) => i.phase === 'produce').map((i) => i.id)).toEqual(
			producesBefore
		);
		expect(s.stage2.items.some((i) => i.phase === 'contrast' && i.id.startsWith('r-'))).toBe(true);
		expect(s.stage2.failedPhases).toEqual([]);
		expect(phaseStatus(s, 'contrast')).toBe('ready');
	});

	it('a wholly failed stage 1 is replaced by the retry', () => {
		let s = newSession(grammarKakadouka.card);
		s = applyStageFailure(s, 1, 'down');
		expect(canStart(s)).toBe(false);
		s = applyStageResult(beginRetry(s, 1), 1, ok(1, itemsOfStage(grammarKakadouka, 1)));
		expect(canStart(s)).toBe(true);
	});
});

describe('playing', () => {
	it('walks phases through boundaries to done', () => {
		let s = started(grammarKakadouka);
		expect(s.at).toBe('item');
		expect(currentItem(s)?.phase).toBe('understand');
		s = playPhase(s);
		expect(s.at).toBe('boundary');
		expect(nextPhaseInfo(s)).toEqual({ phase: 'produce', status: 'ready' });
		s = continueFromBoundary(s);
		expect(currentItem(s)?.phase).toBe('produce');
		for (let i = 0; i < 3; i++) s = playPhase(continueFromBoundary(s));
		expect(s.at).toBe('done');
		expect(phaseScores(s).map((p) => p.phase)).toEqual([
			'understand',
			'produce',
			'use',
			'contrast'
		]);
	});

	it('does not continue into a phase that is still waiting', () => {
		let s = newSession(grammarKakadouka.card);
		s = applyStageResult(s, 1, ok(1, itemsOfStage(grammarKakadouka, 1)));
		s = playPhase(start(s));
		expect(s.at).toBe('boundary');
		expect(nextPhaseInfo(s)?.status).toBe('waiting');
		expect(continueFromBoundary(s)).toBe(s);
		s = applyStageResult(s, 2, ok(2, itemsOfStage(grammarKakadouka, 2)));
		expect(nextPhaseInfo(s)?.status).toBe('ready');
		expect(continueFromBoundary(s).at).toBe('item');
	});

	it('finishHere ends the session with only the played phases scored', () => {
		let s = playPhase(started(grammarKakadouka));
		s = finishHere(s);
		expect(s.at).toBe('done');
		expect(phaseScores(s)).toHaveLength(1);
	});
});

describe('spare re-queue', () => {
	const fx = grammarKakadouka;
	const understand = fx.items.filter((i) => i.phase === 'understand');
	const spare = spareOf(understand[0], 'sp-1');

	it('a miss queues a spare two items later and it is unscored', () => {
		let s = started(fx, [spare]);
		const phaseLen = s.queue.length;
		s = recordResult(s, wrongR);
		expect(s.queue).toHaveLength(phaseLen + 1);
		expect(s.queue[1 + 2]).toBe('sp-1');
		expect(s.requeues).toBe(1);
		s = playPhase(s);
		const score = phaseScores(s)[0];
		expect(score.wrong).toBe(1);
		expect(score.correct + score.wrong + score.neutral).toBe(phaseLen);
		expect(s.results.filter((r) => r.extra)).toHaveLength(1);
	});

	it('a missed spare does not re-queue again, and neutral never re-queues', () => {
		let s = started(fx, [spare, spareOf(understand[1], 'sp-2')]);
		s = recordResult(s, wrongR); // queues sp-1
		const queued = s.queue.length;
		s = recordResult(s, { outcome: 'neutral', attempts: 1, answer: '' });
		expect(s.queue).toHaveLength(queued);
		while (currentItem(s)?.id !== 'sp-1') s = recordResult(s, correct);
		s = recordResult(s, wrongR);
		expect(s.queue.filter((id) => id.startsWith('sp-'))).toEqual(['sp-1']);
		expect(missedItems(s).map((m) => m.extra)).toEqual([false, true]);
	});

	it('does nothing when the phase has no spare left, and stops at the cap', () => {
		let s = started(fx);
		s = recordResult(s, wrongR);
		expect(s.requeues).toBe(0);

		const many = Array.from({ length: MAX_REQUEUES + 2 }, (_, i) =>
			spareOf(understand[0], `sp-${i}`)
		);
		s = { ...started(fx, many), requeues: MAX_REQUEUES };
		s = recordResult(s, wrongR);
		expect(s.requeues).toBe(MAX_REQUEUES);
	});

	it('prefers a spare of the same kind', () => {
		const produce = fx.items.filter((i) => i.phase === 'produce');
		const typedItem = produce.find((i) => i.kind === 'typed')!;
		const tilesItem = produce.find((i) => i.kind === 'tiles')!;
		let s = started(fx, [spareOf(tilesItem, 'sp-tiles'), spareOf(typedItem, 'sp-typed')]);
		s = continueFromBoundary(playPhase(s));
		while (currentItem(s)?.kind !== 'typed') s = recordResult(s, correct);
		s = recordResult(s, wrongR);
		const queuedSpare = s.queue.map((id) => findItem(s, id)!).find((it) => it.spare);
		expect(queuedSpare?.kind).toBe('typed');
	});
});

describe('rounds', () => {
	it('avoidFor lists the sentences used and is capped', () => {
		const s = started(wordKibishii);
		const avoid = avoidFor(s);
		expect(avoid.length).toBeGreaterThan(0);
		expect(avoid.length).toBeLessThanOrEqual(MAX_AVOID_SENTENCES);
		const next = nextRound(s);
		expect(next.round).toBe(2);
		expect(next.usedSentences).toEqual(avoid);
		expect(next.at).toBe('not_started');
		expect(next.results).toEqual([]);
	});

	it('is JSON-safe (the state is the snapshot)', () => {
		const s = recordResult(started(grammarKakadouka), wrongR);
		expect(JSON.parse(JSON.stringify(s))).toEqual(s);
	});
});
