import { TARGET_TYPES } from './types';
import type { TargetType } from './types';

/**
 * Flag-button vocabulary (design doc §8). The database column is deliberately
 * unconstrained so this list can change while prompts are tuned; the route and
 * the UI both read it from here.
 */
export const ITEM_FLAG_REASONS = ['answer_wrong', 'unnatural', 'reading_wrong', 'other'] as const;
export const CARD_FLAG_REASONS = ['card_wrong', 'reading_wrong', 'other'] as const;

export const FLAG_REASON_LABELS: Record<string, string> = {
	answer_wrong: 'The answer is wrong',
	unnatural: 'The Japanese sounds unnatural',
	reading_wrong: 'A reading is wrong',
	card_wrong: 'The card is wrong',
	other: 'Something else'
};

const ALL_REASONS: readonly string[] = [...ITEM_FLAG_REASONS, ...CARD_FLAG_REASONS];

export function isFlagReason(value: string): boolean {
	return ALL_REASONS.includes(value);
}

export interface FlagRequest {
	type: TargetType;
	targetKey: string;
	/** Absent for a flag on the card itself. */
	phase?: string;
	/** The item as shown (JSON); absent for the card. */
	item?: unknown;
	reason: string;
	note?: string;
}

export const MAX_FLAG_NOTE = 500;
export const MAX_FLAG_ITEM_JSON = 6000;

export function isTargetType(value: string): value is TargetType {
	return (TARGET_TYPES as readonly string[]).includes(value);
}
