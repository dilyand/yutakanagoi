import { skeletonFor } from './skeleton';
import { canonicalCoverage, coverageUniverse, validateItems } from './validate-items';
import type { DroppedItem, SetIssue, ValidateOptions, ValidationResult } from './validate-items';
import type { LimitOutcome } from './lookup';
import type { Card, Item, PhaseId } from './types';

/**
 * Pure pieces of session generation (design doc §5 failure policy, §6): spare
 * promotion, the plan for regenerating a phase that came back short, merging
 * the two parallel stages, and the response shape of the generate route.
 * Everything here works on already-parsed items and never throws.
 */

export type GenerationStage = 1 | 2;

/** Spares asked for per comprehension phase in stage 1 (0 turns them off). */
export const SPARES_STAGE_1_PER_PHASE = 1;

/**
 * How many spares each stage is asked for, per phase. A stage owns the spares
 * for its own phases — validateItems rejects out-of-stage items, so stage 2
 * cannot back-fill a stage-1 phase. Stage 2 spares go where a miss is most
 * likely: Produce (typed and tiles), then Use and Contrast.
 */
export function spareQuota(
	card: Card,
	stage: GenerationStage
): { phase: PhaseId; count: number }[] {
	const quota: { phase: PhaseId; count: number }[] = [];
	for (const p of skeletonFor(card)) {
		if (p.stage !== stage) continue;
		const count = stage === 1 ? SPARES_STAGE_1_PER_PHASE : p.id === 'produce' ? 2 : 1;
		if (count > 0) quota.push({ phase: p.id, count });
	}
	return quota;
}

// --- Spare promotion ---------------------------------------------------------

function primariesIn(items: Item[], phase: PhaseId): Item[] {
	return items.filter((i) => i.phase === phase && !i.spare);
}

/**
 * "Drop the invalid item and promote a validated spare of the same phase."
 * Spares are validated like primaries, so a promoted one is never worse. For a
 * phase still short of its target count, spares are promoted until it is full
 * or they run out; among several, the one whose coverage key is least
 * represented so far goes first, so promotion doesn't undo the spread.
 * Returns new items; the input is not mutated.
 */
export function promoteSpares(card: Card, items: Item[]): Item[] {
	const promote = new Set<Item>();
	for (const p of skeletonFor(card)) {
		const need = p.count - primariesIn(items, p.id).length;
		if (need <= 0) continue;
		const keyCount = new Map<string, number>();
		for (const i of primariesIn(items, p.id)) {
			if (i.coverage) {
				const key = canonicalCoverage(i.coverage);
				keyCount.set(key, (keyCount.get(key) ?? 0) + 1);
			}
		}
		const spares = items.filter((i) => i.phase === p.id && i.spare);
		const load = (i: Item) => (i.coverage ? (keyCount.get(canonicalCoverage(i.coverage)) ?? 0) : 0);
		for (let n = 0; n < need && spares.length > 0; n++) {
			// Stable: the earliest spare wins a tie.
			const best = spares.reduce((a, b) => (load(b) < load(a) ? b : a));
			spares.splice(spares.indexOf(best), 1);
			promote.add(best);
			if (best.coverage) {
				const key = canonicalCoverage(best.coverage);
				keyCount.set(key, (keyCount.get(key) ?? 0) + 1);
			}
		}
	}
	return items.map((i) => {
		if (!promote.has(i)) return i;
		const { spare: _spare, ...rest } = i; // eslint-disable-line @typescript-eslint/no-unused-vars
		return rest as Item;
	});
}

/**
 * validateItems, then spare promotion, then validateItems again on the promoted
 * set — so minimums and coverage are judged after promotion, not before. The
 * second pass is deterministic and drops nothing the first kept; `dropped` is
 * the first pass's.
 */
export function validateStage(
	card: Card,
	raw: unknown[],
	options: ValidateOptions = {}
): ValidationResult {
	const first = validateItems(card, raw, options);
	const promoted = promoteSpares(card, first.valid);
	if (promoted.every((item, i) => item === first.valid[i])) return first;
	const second = validateItems(card, promoted, options);
	return { valid: second.valid, dropped: first.dropped, setIssues: second.setIssues };
}

// --- Regeneration ------------------------------------------------------------

/** One phase to ask the model for again, and why. */
export interface RegenerationRequest {
	phase: PhaseId;
	/** Primary items still missing (capped at the phase's target count). */
	need: number;
	/** Coverage keys the new items must cover (`sense:2`, `side:a`, ...). */
	coverage: string[];
	reasons: string[];
}

/** The phase the coverage keys live in, if it belongs to this stage. */
function coveragePhase(card: Card, stage: GenerationStage): PhaseId | null {
	const spec = skeletonFor(card).filter((p) => p.stage === stage);
	const has = (id: PhaseId) => spec.some((p) => p.id === id);
	switch (card.type) {
		case 'word':
			return has('sense') ? 'sense' : has('understand') ? 'understand' : null;
		case 'kanji':
			return has('reading') ? 'reading' : null;
		case 'contrast':
			return has('sort') ? 'sort' : null;
		default:
			return null;
	}
}

/**
 * Turns a stage's set issues into the phases worth regenerating once
 * (design doc §5/§8). Regenerates for: a phase below its minimum, an
 * unbalanced Contrast Sort, a Set phrase Situation with no non-target answer,
 * and a coverage key nothing covers. `coverage_dominant` is deliberately NOT
 * here — a lopsided spread is worth logging, not another call. The new items
 * are added to the existing valid ones, so a phase can end up a little over its
 * target count. Returns [] when nothing needs redoing.
 */
export function regenerationPlan(
	card: Card,
	stage: GenerationStage,
	items: Item[],
	issues: SetIssue[]
): RegenerationRequest[] {
	const spec = skeletonFor(card).filter((p) => p.stage === stage);
	const plan = new Map<PhaseId, RegenerationRequest>();
	const ask = (phase: PhaseId, need: number, reason: string, coverage: string[] = []) => {
		const target = spec.find((p) => p.id === phase);
		if (!target || need <= 0) return;
		const existing = plan.get(phase) ?? { phase, need: 0, coverage: [], reasons: [] };
		existing.coverage = [...new Set([...existing.coverage, ...coverage])];
		// Capped at the phase's target count, except that every missing coverage key
		// needs an item of its own (a Kanji card can have more readings than Reading has slots).
		existing.need = Math.min(
			Math.max(target.count, existing.coverage.length),
			Math.max(existing.need, need)
		);
		existing.reasons.push(reason);
		plan.set(phase, existing);
	};

	const primaries = items.filter((i) => !i.spare);
	for (const issue of issues) {
		switch (issue.code) {
			case 'phase_below_minimum': {
				const target = spec.find((p) => p.id === issue.phase);
				if (target) {
					ask(target.id, target.count - primariesIn(items, target.id).length, issue.detail);
				}
				break;
			}
			case 'sort_unbalanced': {
				const sort = primariesIn(items, 'sort');
				const a = sort.filter((i) => i.coverage === 'side:a').length;
				const b = sort.filter((i) => i.coverage === 'side:b').length;
				ask('sort', Math.abs(a - b) - 1, issue.detail, [a < b ? 'side:a' : 'side:b']);
				break;
			}
			case 'no_non_target_situation':
				ask('situation', 1, issue.detail);
				break;
			default:
				break;
		}
	}

	if (issues.some((i) => i.code === 'coverage_missing')) {
		const covered = new Set(
			primaries.filter((i) => i.coverage).map((i) => canonicalCoverage(i.coverage!))
		);
		const missing = coverageUniverse(card).filter((k) => !covered.has(k));
		const phase = coveragePhase(card, stage);
		if (phase && missing.length > 0) {
			ask(phase, missing.length, `nothing covers ${missing.join(', ')}`, missing);
		}
	}
	return [...plan.values()];
}

/** Phases a stage could not fill — the learner can't be given these. */
export function failedPhases(issues: SetIssue[]): PhaseId[] {
	return issues.flatMap((i) => (i.code === 'phase_below_minimum' && i.phase ? [i.phase] : []));
}

// --- Merging the two stages --------------------------------------------------

export interface MergedSession {
	items: Item[];
	/** Stage-2 items dropped because they repeat a stage-1 sentence. */
	dropped: DroppedItem[];
	setIssues: SetIssue[];
}

/**
 * Stages 1 and 2 are generated in parallel and can't see each other, so the
 * cross-stage dedupe happens here, once both are back: stage 2 is re-validated
 * against stage 1 (`priorItems`), and spares are re-promoted for any Produce /
 * Use item that turned out to be a repeat. Stage 1 is kept as is.
 */
export function mergeStages(card: Card, stage1: Item[], stage2: Item[]): MergedSession {
	const { valid, dropped, setIssues } = validateStage(card, stage2, {
		stage: 2,
		priorItems: stage1
	});
	return { items: [...stage1, ...valid], dropped, setIssues };
}

// --- Response ------------------------------------------------------------------

export interface GenerateOk {
	status: 'ok';
	stage: GenerationStage;
	/** Primaries and spares (`spare: true`), validated. */
	items: Item[];
	/** Phase minimums, coverage and balance problems that survived promotion and regeneration. */
	setIssues: SetIssue[];
	/** True when a second call refilled a short phase. */
	regenerated: boolean;
}

/** `limit` is the same 200-status outcome the lookup routes use (not a 429). */
export type GenerateResponse = GenerateOk | LimitOutcome;
