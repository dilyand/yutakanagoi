import type { SupabaseClient } from '@supabase/supabase-js';

export interface AppUser {
	id: number;
	username: string;
}

/** All users, for the username dropdown. Users are created out-of-band via scripts/add-user.ts. */
export async function listUsers(supabase: SupabaseClient): Promise<AppUser[]> {
	const { data, error } = await supabase.from('users').select('id, username').order('username');
	if (error) throw error;
	return data;
}

export interface WordListSummary {
	id: number;
	name: string;
}

/** A user's own word lists only — lists are private per user. */
export async function listWordListsForUser(
	supabase: SupabaseClient,
	userId: number
): Promise<WordListSummary[]> {
	const { data, error } = await supabase
		.from('word_lists')
		.select('id, name')
		.eq('user_id', userId)
		.order('name');
	if (error) throw error;
	return data;
}

export class ListNameConflictError extends Error {
	constructor(name: string) {
		super(`A list named "${name}" already exists for this user.`);
		this.name = 'ListNameConflictError';
	}
}

/**
 * Creates a word list and its words in one call. Throws ListNameConflictError
 * if this user already has a list with this name (list name = uploaded
 * filename, and re-uploading the same filename is rejected rather than
 * silently overwriting progress).
 */
export async function createWordList(
	supabase: SupabaseClient,
	userId: number,
	name: string,
	words: string[]
): Promise<number> {
	const { data: listRow, error: listError } = await supabase
		.from('word_lists')
		.insert({ user_id: userId, name })
		.select('id')
		.single();
	if (listError) {
		// Postgres unique_violation on word_lists(user_id, name).
		if (listError.code === '23505') throw new ListNameConflictError(name);
		throw listError;
	}

	const { error: wordsError } = await supabase.from('list_words').insert(
		words.map((word, index) => ({
			list_id: listRow.id,
			word,
			frequency_rank: index + 1
		}))
	);
	if (wordsError) throw wordsError;

	return listRow.id;
}
