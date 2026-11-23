import type { SupabaseClient } from '@supabase/supabase-js';
import { logError } from '$lib/server/logger';
import { withRetry } from '$lib/server/retry';
import { buildCandidates, foldKey } from '$lib/target-practice/dictionary';
import type { DictionaryEntry } from '$lib/target-practice/dictionary';
import { validateCandidates } from '$lib/target-practice/lookup';
import type { CandidatesResponse } from '$lib/target-practice/lookup';

/**
 * Word candidates from the local JMdict table (design doc §2 step 2): no model
 * call, so no usage cap and no `limit` outcome. The picker's contents come from
 * `buildCandidates` and still pass through `validateCandidates`, the same trust
 * boundary the model's candidates went through.
 */

// Enough rows that the common ones are always among them: the query orders common
// first, and the picker only ever shows MAX_CANDIDATES.
const MAX_ROWS = 40;

// The input was validated as Japanese script plus ASCII letters/digits already; this
// keeps anything else (commas, braces, quotes) out of the array-contains filter.
const SAFE_KEY = /^[\p{L}\p{N}]+$/u;

export async function lookupWordInDictionary(
	supabase: SupabaseClient,
	input: string
): Promise<CandidatesResponse> {
	const key = foldKey(input);
	if (!SAFE_KEY.test(key)) return { status: 'none' };

	const { data, error } = await withRetry(() =>
		supabase
			.from('dictionary_entries')
			.select('id, common, kanji, kana, senses')
			.contains('lookup_keys', [key])
			.order('common', { ascending: false })
			.order('id', { ascending: true })
			.limit(MAX_ROWS)
	);
	if (error) throw error;

	const entries = (data ?? []) as DictionaryEntry[];
	const { valid, dropped } = validateCandidates('word', buildCandidates(key, entries));
	// Dropped candidates are normal (a duplicate reading, a form with punctuation). Only
	// "the dictionary matched but nothing usable came out" is worth a trace.
	if (valid.length === 0 && entries.length > 0) {
		await logError('target-practice/lookup/dictionary', new Error('no usable candidates'), {
			input: key,
			matched: entries.length,
			dropped
		});
	}
	return valid.length > 0 ? { status: 'ok', candidates: valid } : { status: 'none' };
}
