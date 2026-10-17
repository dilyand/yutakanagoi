import type { SupabaseClient } from '@supabase/supabase-js';
import { withRetry } from '$lib/server/retry';
import { targetKey } from '$lib/target-practice/lookup';
import type { RecentTarget } from '$lib/target-practice/lookup';
import { TARGET_TYPES } from '$lib/target-practice/types';
import type { Card, TargetType } from '$lib/target-practice/types';
import { validateCard } from '$lib/target-practice/validate-card';

/** Rows kept per user; the recents list shows only the newest few. */
export const HISTORY_LIMIT = 30;
export const RECENTS_SHOWN = 8;

interface HistoryRow {
	type: string;
	target_key: string;
	card: unknown;
	last_practiced_at: string;
}

/**
 * The learner's most recent targets, newest first (design doc §8). Each stored
 * card is re-validated on the way out: the card shape can evolve between
 * releases, and a stale row should drop out of the list rather than hand the
 * UI (and, later, a generation prompt) something validateCard would refuse.
 */
export async function listRecentTargets(
	supabase: SupabaseClient,
	userId: number,
	limit: number = RECENTS_SHOWN
): Promise<RecentTarget[]> {
	const { data, error } = await withRetry(() =>
		supabase
			.from('target_practice_history')
			.select('type, target_key, card, last_practiced_at')
			.eq('user_id', userId)
			.order('last_practiced_at', { ascending: false })
			.limit(limit)
	);
	if (error) throw error;

	const recents: RecentTarget[] = [];
	for (const row of (data ?? []) as HistoryRow[]) {
		const type = TARGET_TYPES.find((t) => t === row.type);
		if (!type) continue;
		const checked = validateCard(row.card, type);
		if (checked.status !== 'ok') continue;
		recents.push({
			type,
			targetKey: row.target_key,
			card: checked.card,
			lastPracticedAt: row.last_practiced_at
		});
	}
	return recents;
}

/**
 * Records that `card` was just practised: inserts its row, or bumps
 * `last_practiced_at` (and refreshes the stored card) if it is already there,
 * then prunes the user's history to HISTORY_LIMIT. Called after generation
 * succeeds, never on lookup alone. Idempotent, so safe under withRetry.
 *
 * The prune is a second query, so two concurrent writes can leave one row over
 * the limit until the next write; harmless for a recents list. It cuts at the
 * timestamp of the HISTORY_LIMIT-th newest row, which also needs no quoting of
 * Japanese keys in a filter.
 */
export async function recordPracticedTarget(
	supabase: SupabaseClient,
	userId: number,
	card: Card
): Promise<void> {
	const { error } = await withRetry(() =>
		supabase.from('target_practice_history').upsert(
			{
				user_id: userId,
				type: card.type,
				target_key: targetKey(card),
				card,
				// The column default doesn't fire on conflict, so bump it explicitly.
				last_practiced_at: new Date().toISOString()
			},
			{ onConflict: 'user_id,type,target_key' }
		)
	);
	if (error) throw error;

	const { data: cutoff, error: cutoffError } = await withRetry(() =>
		supabase
			.from('target_practice_history')
			.select('last_practiced_at')
			.eq('user_id', userId)
			.order('last_practiced_at', { ascending: false })
			.range(HISTORY_LIMIT - 1, HISTORY_LIMIT - 1)
	);
	if (cutoffError) throw cutoffError;
	const oldestKept = (cutoff as { last_practiced_at: string }[] | null)?.[0]?.last_practiced_at;
	if (!oldestKept) return; // fewer than HISTORY_LIMIT rows: nothing to prune

	const { error: pruneError } = await withRetry(() =>
		supabase
			.from('target_practice_history')
			.delete()
			.eq('user_id', userId)
			.lt('last_practiced_at', oldestKept)
	);
	if (pruneError) throw pruneError;
}

/**
 * Removes one recents entry. Scoped by the session-derived userId, so a key
 * belonging to another user (or to nobody) simply matches nothing.
 */
export async function deleteRecentTarget(
	supabase: SupabaseClient,
	userId: number,
	type: TargetType,
	key: string
): Promise<void> {
	const { error } = await withRetry(() =>
		supabase
			.from('target_practice_history')
			.delete()
			.eq('user_id', userId)
			.eq('type', type)
			.eq('target_key', key)
	);
	if (error) throw error;
}
