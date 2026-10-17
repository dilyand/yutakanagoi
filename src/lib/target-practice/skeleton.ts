import type { Card, PhaseId, TargetType } from './types';

/**
 * Fixed phase structure per target type (design doc §4). Generation stage 1
 * is the comprehension phases, stage 2 the production phases (§6) — they are
 * generated and validated separately, so each phase records which it is.
 */
export interface PhaseSpec {
	id: PhaseId;
	/** Graded items the phase aims for. */
	count: number;
	/** Fewest valid primaries before the phase must be regenerated ("about two"). */
	min: number;
	stage: 1 | 2;
}

const MIN_PER_PHASE = 2;

function phase(id: PhaseId, count: number, stage: 1 | 2): PhaseSpec {
	return { id, count, min: Math.min(MIN_PER_PHASE, count), stage };
}

const SKELETONS: Record<TargetType, PhaseSpec[]> = {
	grammar: [
		phase('understand', 4, 1),
		phase('produce', 5, 2),
		phase('use', 4, 2), // 3 guided + 1 free
		phase('contrast', 3, 2)
	],
	contrast: [
		phase('understand', 3, 1),
		phase('sort', 5, 1),
		phase('produce', 4, 2),
		phase('use', 3, 2)
	],
	word: [
		phase('understand', 4, 1),
		phase('sense', 3, 1),
		phase('produce', 5, 2),
		phase('use', 3, 2)
	],
	kanji: [
		phase('understand', 4, 1),
		phase('reading', 3, 1),
		phase('produce', 5, 2),
		phase('use', 3, 2)
	],
	set_phrase: [
		phase('understand', 4, 1),
		phase('situation', 3, 1),
		phase('produce', 5, 2),
		phase('use', 3, 2)
	]
};

/**
 * A single-sense Word has nothing to discriminate, so the Sense phase is
 * replaced by extra collocation items in Understand and Produce (design doc
 * §4 / memory: "single-sense word drops the Sense phase"). Same 15-item total.
 */
const SINGLE_SENSE_WORD: PhaseSpec[] = [
	phase('understand', 6, 1),
	phase('produce', 6, 2),
	phase('use', 3, 2)
];

export function skeletonFor(card: Card): PhaseSpec[] {
	if (card.type === 'word' && card.senses.length === 1) return SINGLE_SENSE_WORD;
	return SKELETONS[card.type];
}

export function totalItems(spec: PhaseSpec[]): number {
	return spec.reduce((sum, p) => sum + p.count, 0);
}

/** Which item kinds each phase accepts. */
export const PHASE_KINDS: Record<PhaseId, ReadonlyArray<'mc' | 'typed' | 'tiles' | 'claude'>> = {
	understand: ['mc'],
	sense: ['mc'],
	reading: ['mc'],
	situation: ['mc'],
	sort: ['mc'],
	produce: ['typed', 'tiles'],
	use: ['claude'],
	contrast: ['mc', 'typed']
};
