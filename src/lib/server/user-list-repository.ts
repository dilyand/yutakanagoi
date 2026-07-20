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

export interface UserWithPasswordHash {
	id: number;
	username: string;
	passwordHash: string | null;
}

/** Looks up a user by username for login — includes password_hash (null if
 * scripts/set-password.ts hasn't been run for this user yet), unlike
 * listUsers which deliberately never returns it. */
export async function findUserByUsername(
	supabase: SupabaseClient,
	username: string
): Promise<UserWithPasswordHash | null> {
	const { data, error } = await withRetry(() =>
		supabase
			.from('users')
			.select('id, username, password_hash')
			.eq('username', username)
			.maybeSingle()
	);
	if (error) throw error;
	if (!data) return null;
	return { id: data.id, username: data.username, passwordHash: data.password_hash };
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
 * Throws ListNotFoundError unless listId belongs to userId. userId here
 * should always be the session-derived id from requireUserId, not a
 * client-supplied one — this only guards a bug/typo passing the wrong
 * listId, it isn't the identity check itself (see CLAUDE.md).
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
 * filename with its extension stripped, and re-uploading the same filename
 * is rejected rather than silently overwriting progress).
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

/**
 * Merges new words into an existing list, found by (userId, name) — the
 * client only has the filename at this point, not the listId. Additive
 * only: words already in the list (by exact text match) are left
 * completely untouched (word, frequency_rank, word_state,
 * vocab_session_attempts), so re-uploading an expanded version of a list
 * never disturbs progress already made on it. New words are appended after
 * the current highest frequency_rank — derived from the real max, not
 * assumed to be a contiguous count(), so this can't collide with an
 * existing row. Throws ListNotFoundError if no list matches.
 */
export async function updateWordList(
	supabase: SupabaseClient,
	userId: number,
	name: string,
	words: string[]
): Promise<{ listId: number; addedCount: number }> {
	const { data: listRow, error: listError } = await withRetry(() =>
		supabase.from('word_lists').select('id').eq('user_id', userId).eq('name', name).maybeSingle()
	);
	if (listError) throw listError;
	if (!listRow) throw new ListNotFoundError();

	const listId = listRow.id;

	const { data: existingRows, error: existingError } = await withRetry(() =>
		supabase.from('list_words').select('word, frequency_rank').eq('list_id', listId)
	);
	if (existingError) throw existingError;

	const existingWords = new Set(existingRows.map((row) => row.word));
	const maxRank = existingRows.reduce((max, row) => Math.max(max, row.frequency_rank), 0);

	const seen = new Set<string>();
	const newWords: string[] = [];
	for (const word of words) {
		if (existingWords.has(word) || seen.has(word)) continue;
		seen.add(word);
		newWords.push(word);
	}

	if (newWords.length === 0) {
		return { listId, addedCount: 0 };
	}

	const { error: insertError } = await withRetry(() =>
		supabase.from('list_words').insert(
			newWords.map((word, index) => ({
				list_id: listId,
				word,
				frequency_rank: maxRank + index + 1
			}))
		)
	);
	if (insertError) throw insertError;

	return { listId, addedCount: newWords.length };
}

export class WordNotFoundError extends Error {
	constructor() {
		super('Word not found in this list.');
		this.name = 'WordNotFoundError';
	}
}

export class WordConflictError extends Error {
	constructor(word: string) {
		super(`"${word}" is already in this list.`);
		this.name = 'WordConflictError';
	}
}

/**
 * Renames a single word in place — used by the drill card's inline edit
 * control (e.g. fixing a typo or a wrong entry from an imported list) as
 * well as scripts/fix-hellotalk-words-corrections.ts's one-off cleanups.
 * word_state and vocab_session_attempts both have a real composite FK to
 * list_words(list_id, word) with no ON UPDATE CASCADE, so this can't be a
 * plain UPDATE — same insert-at-placeholder-rank -> repoint history ->
 * delete old -> restore rank dance as scrub-master-list-cleanup.ts's
 * REPLACE flow (see supabase/README.md's migration gotchas), generalized
 * to one arbitrary word instead of a hardcoded pair list. Throws
 * WordNotFoundError if oldWord isn't in the list, WordConflictError if
 * newWord already is (merging progress into an existing word is out of
 * scope here).
 */
export async function renameListWord(
	supabase: SupabaseClient,
	listId: number,
	oldWord: string,
	newWord: string
): Promise<void> {
	const { data: oldRow, error: oldRowError } = await withRetry(() =>
		supabase
			.from('list_words')
			.select('frequency_rank')
			.eq('list_id', listId)
			.eq('word', oldWord)
			.maybeSingle()
	);
	if (oldRowError) throw oldRowError;
	if (!oldRow) throw new WordNotFoundError();

	const { data: conflictRow, error: conflictError } = await withRetry(() =>
		supabase.from('list_words').select('id').eq('list_id', listId).eq('word', newWord).maybeSingle()
	);
	if (conflictError) throw conflictError;
	if (conflictRow) throw new WordConflictError(newWord);

	const { error: insertError } = await withRetry(() =>
		supabase
			.from('list_words')
			.upsert(
				{ list_id: listId, word: newWord, frequency_rank: -oldRow.frequency_rank },
				{ onConflict: 'list_id,word' }
			)
	);
	if (insertError) throw insertError;

	const { error: wordStateError } = await withRetry(() =>
		supabase.from('word_state').update({ word: newWord }).eq('list_id', listId).eq('word', oldWord)
	);
	if (wordStateError) throw wordStateError;

	const { error: attemptsError } = await withRetry(() =>
		supabase
			.from('vocab_session_attempts')
			.update({ word: newWord })
			.eq('list_id', listId)
			.eq('word', oldWord)
	);
	if (attemptsError) throw attemptsError;

	const { error: deleteOldError } = await withRetry(() =>
		supabase.from('list_words').delete().eq('list_id', listId).eq('word', oldWord)
	);
	if (deleteOldError) throw deleteOldError;

	const { error: restoreRankError } = await withRetry(() =>
		supabase
			.from('list_words')
			.update({ frequency_rank: oldRow.frequency_rank })
			.eq('list_id', listId)
			.eq('word', newWord)
	);
	if (restoreRankError) throw restoreRankError;
}
