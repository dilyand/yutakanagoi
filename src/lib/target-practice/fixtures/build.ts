import type {
	Card,
	ClaudeItem,
	Item,
	McItem,
	McOption,
	PhaseId,
	TilesItem,
	TypedItem
} from '../types';

/** A complete worked session from Appendix A: the confirmed card plus every item. */
export interface Fixture {
	name: string;
	card: Card;
	items: Item[];
}

type Common = 'rationale' | 'targetSpan';
type Rest<T> = Pick<T, Common & keyof T> &
	Partial<
		Omit<T, 'id' | 'phase' | 'kind' | Common | 'options' | 'tiles' | 'accepted' | 'expected'>
	>;

export const right = (text: string): McOption => ({ text, correct: true });
export const wrong = (text: string, tag?: string): McOption =>
	tag === undefined ? { text, correct: false } : { text, correct: false, tag };

export function mc(id: string, phase: PhaseId, fields: Rest<McItem>, options: McOption[]): McItem {
	return { id, phase, kind: 'mc', ...fields, options };
}

export function typed(
	id: string,
	phase: PhaseId,
	fields: Rest<TypedItem> & Pick<TypedItem, 'form' | 'answer' | 'accepted' | 'hint'>
): TypedItem {
	return { id, phase, kind: 'typed', ...fields };
}

/** `tiles` is the DISPLAY order — a hand-written shuffle that differs from every accepted order. */
export function tiles(
	id: string,
	phase: PhaseId,
	fields: Rest<TilesItem>,
	displayTiles: string[],
	accepted: string[]
): TilesItem {
	return { id, phase, kind: 'tiles', ...fields, tiles: displayTiles, accepted };
}

export function claude(
	id: string,
	phase: PhaseId,
	fields: Rest<ClaudeItem>,
	expected: string[]
): ClaudeItem {
	return { id, phase, kind: 'claude', ...fields, expected };
}
