import type { SupabaseClient } from '@supabase/supabase-js';
import type { FlagRequest } from '$lib/target-practice/flags';

/**
 * Stores a flag-button report (design doc §8). Read back with `npm run
 * logs:flags` to tune prompts. Not wrapped in withRetry: an insert after a lost
 * response would store the report twice, and a lost report is cheap.
 */
export async function insertFlag(
	supabase: SupabaseClient,
	userId: number,
	flag: FlagRequest
): Promise<void> {
	const { error } = await supabase.from('target_practice_flags').insert({
		user_id: userId,
		type: flag.type,
		target_key: flag.targetKey,
		phase: flag.phase ?? null,
		item: flag.item ?? null,
		reason: flag.reason,
		note: flag.note?.trim() || null
	});
	if (error) throw error;
}
