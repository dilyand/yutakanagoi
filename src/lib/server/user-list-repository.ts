import type { SupabaseClient } from '@supabase/supabase-js';
import { withRetry } from '$lib/server/retry';

export interface AppUser {
	id: number;
	username: string;
}

/** All users, for the username dropdown. Users are created out-of-band via scripts/add-user.ts. */
export async function listUsers(supabase: SupabaseClient): Promise<AppUser[]> {
	const { data, error } = await withRetry(() =>
		supabase.from('users').select('id, username').order('username')
	);
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
	const { data, error } = await withRetry(() =>
		supabase.from('word_lists').select('id, name').eq('user_id', userId).order('name')
	);
	if (error) throw error;
	return data;
}

export class ListNameConflictError extends Error {
	constructor(name: string) {
		super(`A list named "${name}" already exists for this user.`);
		this.name = 'ListNameConflictError';
	}
}

export class ListNotFoundError extends Error {
	constructor() {
		super('List not found for this user.');
		this.name = 'ListNotFoundError';
	}
}

/**
 * Throws ListNotFoundError unless listId belongs to userId. listId/userId
 * are client-supplied integers with no other identity binding (the app has
 * one shared passphrase, not per-user auth — see CLAUDE.md), so every route
 * that accepts both must call this before touching that list's data.
 */
export async function verifyListOwnership(
	supabase: SupabaseClient,
	listId: number,
	userId: number
): Promise<void> {
	const { data, error } = await withRetry(() =>
		supabase.from('word_lists').select('id').eq('id', listId).eq('user_id', userId).maybeSingle()
	);
	if (error) throw error;
	if (!data) throw new ListNotFoundError();
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
	const { data: listRow, error: listError } = await withRetry(() =>
		supabase.from('word_lists').insert({ user_id: userId, name }).select('id').single()
	);
	if (listError) {
		// Postgres unique_violation on word_lists(user_id, name).
		if (listError.code === '23505') throw new ListNameConflictError(name);
		throw listError;
	}

	const { error: wordsError } = await withRetry(() =>
		supabase.from('list_words').insert(
			words.map((word, index) => ({
				list_id: listRow.id,
				word,
				frequency_rank: index + 1
			}))
		)
	);
	if (wordsError) throw wordsError;

	return listRow.id;
}
