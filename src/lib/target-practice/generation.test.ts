import { describe, expect, it } from 'vitest';
import {
	SPARES_STAGE_1_PER_PHASE,
	failedPhases,
	mergeStages,
	promoteSpares,
	regenerationPlan,
	spareQuota,
	validateStage
} from './generation';
import {
	contrastKimeruKimaru,
	grammarKakadouka,
	kanjiKai,
	setPhraseOtsukaresama,
	wordKibishii
} from './fixtures';
import type { Fixture } from './fixtures';
import { skeletonFor } from './skeleton';
import { validateItems } from './validate-items';
import type { Item } from './types';

function clone<T>(v: T): T {
	return JSON.parse(JSON.stringify(v)) as T;
}
const without = (fx: Fixture, ids: string[]) => fx.items.filter((i) => !ids.includes(i.id));
const stageItems = (fx: Fixture, stage: 1 | 2) =>
	fx.items.filter((i) => skeletonFor(fx.card).find((p) => p.id === i.phase)?.stage === stage);

describe('spareQuota', () => {
	it('stage 1: one per comprehension phase, owned by that stage', () => {
		expect(spareQuota(wordKibishii.card, 1)).toEqual([
			{ phase: 'understand', count: SPARES_STAGE_1_PER_PHASE },
			{ phase: 'sense', count: SPARES_STAGE_1_PER_PHASE }
		]);
	});

	it('stage 2: two Produce spares, one each for Use and (Grammar) Contrast', () => {
		expect(spareQuota(grammarKakadouka.card, 2)).toEqual([
			{ phase: 'produce', count: 2 },
			{ phase: 'use', count: 1 },
			{ phase: 'contrast', count: 1 }
		]);
		expect(spareQuota(kanjiKai.card, 2).map((q) => q.phase)).toEqual(['produce', 'use']);
	});
});

describe('promoteSpares', () => {
	const sortItems = (spareIds: string[], extra: Item[] = []) => {
		const items = clone(contrastKimeruKimaru.items).map((i) =>
			spareIds.includes(i.id) ? { ...i, spare: true } : i
		);
		return [...items, ...extra];
	};

	it('fills a short phase from its spares and leaves the input alone', () => {
		const items = sortItems(['c-s2', 'c-s3']);
		const out = promoteSpares(contrastKimeruKimaru.card, items);
		expect(out.find((i) => i.id === 'c-s2')).not.toHaveProperty('spare');
		expect(out.find((i) => i.id === 'c-s3')).not.toHaveProperty('spare');
		expect(items.find((i) => i.id === 'c-s2')?.spare).toBe(true);
	});

	it('does nothing when every phase is full', () => {
		const out = promoteSpares(grammarKakadouka.card, grammarKakadouka.items);
		expect(out.find((i) => i.id === 'g-spare1')?.spare).toBe(true);
	});

	it('promotes only as many as the phase needs, preferring the least-covered key', () => {
		const sideA = {
			...clone(contrastKimeruKimaru.items.find((i) => i.id === 'c-s1')!),
			id: 'c-s1b'
		};
		// Primaries: s4 (a), s5 (b), s1 (a) -> a=2, b=1; need 2 more; spares s2 (b), s3 (b), s1b (a).
		const items = sortItems(['c-s2', 'c-s3'], [{ ...sideA, spare: true }]);
		const spareOrder = ['c-s1b', 'c-s2', 'c-s3'];
		const ordered = [
			...items.filter((i) => !spareOrder.includes(i.id)),
			...spareOrder.map((id) => items.find((i) => i.id === id)!)
		];
		const out = promoteSpares(contrastKimeruKimaru.card, ordered);
		const stillSpare = out.filter((i) => i.spare).map((i) => i.id);
		// side:b is under-represented, so a b-spare goes first; then a tie -> the earliest spare.
		expect(stillSpare).toEqual(['c-s3']);
	});

	it('does not promote across phases', () => {
		const items = without(grammarKakadouka, ['g-p1', 'g-p2', 'g-p3', 'g-p4', 'g-p5']);
		const out = promoteSpares(grammarKakadouka.card, items);
		// The only spare is a Produce one, so Produce is refilled and Use is untouched.
		expect(out.filter((i) => i.phase === 'produce' && !i.spare)).toHaveLength(1);
	});
});

describe('validateStage', () => {
	it('promotes a spare so a phase that lost items is no longer below minimum', () => {
		const items = without(grammarKakadouka, ['g-p1', 'g-p2', 'g-p3', 'g-p4']);
		const plain = validateItems(grammarKakadouka.card, clone(items), { stage: 2 });
		expect(plain.setIssues.map((i) => i.code)).toEqual(['phase_below_minimum']);

		const r = validateStage(grammarKakadouka.card, clone(items), { stage: 2 });
		expect(r.setIssues).toEqual([]);
		expect(r.valid.filter((i) => i.phase === 'produce' && !i.spare).map((i) => i.id)).toEqual([
			'g-p5',
			'g-spare1'
		]);
	});

	it('reports the first pass drops, not the promotion bookkeeping', () => {
		const items = clone(stageItems(grammarKakadouka, 2)) as unknown as Record<string, unknown>[];
		delete items.find((i) => i.id === 'g-p1')!.hint;
		const r = validateStage(grammarKakadouka.card, items, { stage: 2 });
		expect(r.dropped).toEqual([{ id: 'g-p1', reason: expect.stringMatching(/^shape: hint/) }]);
		expect(r.valid.find((i) => i.id === 'g-spare1')?.spare).toBeUndefined(); // promoted into g-p1's place
	});

	it('leaves everything alone when nothing is short', () => {
		const items = stageItems(wordKibishii, 1);
		const r = validateStage(wordKibishii.card, clone(items), { stage: 1 });
		expect(r.dropped).toEqual([]);
		expect(r.setIssues).toEqual([]);
		expect(r.valid).toHaveLength(items.length);
	});
});

describe('regenerationPlan', () => {
	const plan = (fx: Fixture, stage: 1 | 2, items: Item[]) => {
		const { valid, setIssues } = validateItems(fx.card, clone(items), { stage });
		return regenerationPlan(fx.card, stage, valid, setIssues);
	};

	it('is empty for a clean stage', () => {
		for (const fx of [grammarKakadouka, contrastKimeruKimaru, wordKibishii, kanjiKai]) {
			expect(plan(fx, 1, stageItems(fx, 1))).toEqual([]);
		}
	});

	it('asks for the missing items of a phase below its minimum', () => {
		const items = without(grammarKakadouka, ['g-u1', 'g-u2', 'g-u3']);
		const stage1 = items.filter((i) => i.phase === 'understand');
		expect(plan(grammarKakadouka, 1, stage1)).toEqual([
			{
				phase: 'understand',
				need: 3,
				coverage: [],
				reasons: [expect.stringContaining('1 valid items')]
			}
		]);
		expect(
			failedPhases(validateItems(grammarKakadouka.card, stage1, { stage: 1 }).setIssues)
		).toEqual(['understand']);
	});

	it('asks for a missing Word sense in the Sense phase, naming the key', () => {
		const items = without(wordKibishii, ['w-u3', 'w-u4', 'w-s3']);
		const p = plan(wordKibishii, 1, stageItems({ ...wordKibishii, items }, 1));
		expect(p).toEqual([
			expect.objectContaining({ phase: 'sense', need: 1, coverage: ['sense:3'] })
		]);
	});

	it('uses the reading phase for Kanji and the sort phase for Contrast coverage', () => {
		const k = plan(
			kanjiKai,
			1,
			without(kanjiKai, ['k-r3']).filter((i) => i.phase === 'reading' || i.phase === 'understand')
		);
		expect(k).toEqual([expect.objectContaining({ phase: 'reading', coverage: ['reading:げ'] })]);
	});

	it('asks for more of the thin side when Sort is unbalanced', () => {
		// Keep only side:a in Sort: s1, s4 (+ an a-flipped s2, s3, s5 would be needed; use relabel).
		const items = clone(contrastKimeruKimaru.items).map((i) =>
			i.phase === 'sort' && i.id !== 'c-s5' ? { ...i, coverage: 'side:a' } : i
		);
		const p = plan(
			contrastKimeruKimaru,
			1,
			items.filter((i) => i.phase === 'understand' || i.phase === 'sort')
		);
		expect(p).toEqual([expect.objectContaining({ phase: 'sort', coverage: ['side:b'] })]);
		expect(p[0].need).toBeGreaterThan(0);
	});

	it('asks for a non-target Situation answer when every answer is the target', () => {
		// Make every Situation item's answer the target phrase itself.
		const items = clone(setPhraseOtsukaresama.items).map((i) => {
			if (i.phase !== 'situation' || i.kind !== 'mc') return i;
			return { ...i, targetSpan: i.options.find((o) => o.correct)!.text };
		});
		const p = plan(
			setPhraseOtsukaresama,
			1,
			items.filter((i) => i.phase === 'understand' || i.phase === 'situation')
		);
		expect(p).toEqual([expect.objectContaining({ phase: 'situation', need: 1, coverage: [] })]);
	});

	it('does not regenerate for a lopsided (dominant) coverage spread alone', () => {
		const items = clone(wordKibishii.items).map((i) =>
			i.phase === 'sense' || i.phase === 'understand' ? { ...i, coverage: 'sense:1' } : i
		);
		const { setIssues } = validateItems(
			wordKibishii.card,
			stageItems({ ...wordKibishii, items }, 1) as Item[],
			{
				stage: 1
			}
		);
		expect(setIssues.some((i) => i.code === 'coverage_dominant')).toBe(true);
	});
});

describe('mergeStages', () => {
	it('drops a stage-2 item repeating a stage-1 sentence and promotes a spare in its place', () => {
		const stage1 = stageItems(grammarKakadouka, 1);
		const stage2 = clone(stageItems(grammarKakadouka, 2)) as Item[];
		const repeat = stage2.find((i) => i.id === 'g-p5')!; // a free typed item: no blank to break
		repeat.sentence = stage1[0].sentence!; // a copy of g-u1's sentence
		repeat.kana = stage1[0].kana!;
		const m = mergeStages(grammarKakadouka.card, stage1, stage2);
		expect(m.dropped).toEqual([
			{ id: 'g-p5', reason: expect.stringMatching(/^duplicate_sentence/) }
		]);
		expect(m.items.map((i) => i.id)).not.toContain('g-p5');
		expect(m.items.find((i) => i.id === 'g-spare1')?.spare).toBeUndefined();
		expect(m.setIssues).toEqual([]);
	});

	it('is a no-op for two clean stages', () => {
		const m = mergeStages(
			wordKibishii.card,
			stageItems(wordKibishii, 1),
			stageItems(wordKibishii, 2)
		);
		expect(m.dropped).toEqual([]);
		expect(m.items).toHaveLength(wordKibishii.items.length);
	});
});
