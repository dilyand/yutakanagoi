import { error } from '@sveltejs/kit';
import { validateTargetInput } from '$lib/target-practice/input-validation';
import type { Card, TargetType } from '$lib/target-practice/types';
import { validateCard } from '$lib/target-practice/validate-card';

/** The card round-trips through the client; this bounds it before it is parsed. */
export const MAX_CARD_JSON = 8000;

/**
 * The trust boundary for a client-supplied card, shared by the generate and
 * grade routes: bounded, re-validated with validateCard, and its target must
 * itself be valid Japanese input for its type — only then may it reach a
 * prompt. Throws a 400 otherwise.
 */
export function parseRequestCard(type: TargetType, rawCard: unknown): Card {
	if (JSON.stringify(rawCard).length > MAX_CARD_JSON) error(400, 'The card is too large.');
	const checked = validateCard(rawCard, type);
	if (checked.status !== 'ok') error(400, 'Invalid card');
	const target = validateTargetInput(type, checked.card.target);
	if (!target.ok || target.language !== 'ja') error(400, 'Invalid card target');
	return checked.card;
}
