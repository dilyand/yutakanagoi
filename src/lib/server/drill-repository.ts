import type { SupabaseClient } from '@supabase/supabase-js';
import type { VocabEntry, WordState } from '$lib/drill-algorithm';
import { fetchAllRows } from '$lib/supabase-pagination';

export interface DrillContext {
	vocabMaster: VocabEntry[];
	wordStates: WordState[];
	sessionIndex: number;
}

interface ListWordRow {
	word: string;
	frequency_rank: number;
}

interface WordStateRow {
	word: string;
	box: number;
	last_session: number;
}

/** Everything selectDrillWords() needs for one list, plus its current (latest) session_index. */
export async function fetchDrillContext(
	supabase: SupabaseClient,
	listId: number
): Promise<DrillContext> {
	// A list can have thousands of words and word_state grows over time — both can
	// exceed PostgREST's default max_rows (1000), so these paginate rather than a
	// plain .select().
	const [listWordsRows, wordStatesRows, sessionIndex] = await Promise.all([
		fetchAllRows<ListWordRow>(supabase, 'list_words', 'word, frequency_rank', {
			list_id: listId
		}),
		fetchAllRows<WordStateRow>(supabase, 'word_state', 'word, box, last_session', {
			list_id: listId
		}),
		getLatestSessionIndex(supabase, listId)
	]);

	return {
		vocabMaster: listWordsRows.map((row) => ({
			word: row.word,
			frequencyRank: row.frequency_rank
		})),
		wordStates: wordStatesRows.map((row) => ({
			word: row.word,
			box: row.box,
			lastSession: row.last_session
		})),
		sessionIndex
	};
}

async function getLatestSessionIndex(supabase: SupabaseClient, listId: number): Promise<number> {
	const { data, error } = await supabase
		.from('sessions')
		.select('session_index')
		.eq('list_id', listId)
		.order('session_index', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	return data?.session_index ?? 0;
}

/** Increments this list's session counter and inserts the new sessions row. */
export async function startSession(supabase: SupabaseClient, listId: number): Promise<number> {
	const nextSessionIndex = (await getLatestSessionIndex(supabase, listId)) + 1;
	const { error } = await supabase
		.from('sessions')
		.insert({ list_id: listId, session_index: nextSessionIndex });
	if (error) throw error;
	return nextSessionIndex;
}

/** Marks a session complete once all words have been drilled. */
export async function completeSession(
	supabase: SupabaseClient,
	listId: number,
	sessionIndex: number,
	wordsDrilled: number
): Promise<void> {
	const { error } = await supabase
		.from('sessions')
		.update({ completed_at: new Date().toISOString(), words_drilled: wordsDrilled })
		.eq('list_id', listId)
		.eq('session_index', sessionIndex);
	if (error) throw error;
}

/** Upserts the post-drill box/last_session for each word drilled this session, scoped to one list. */
export async function upsertWordStates(
	supabase: SupabaseClient,
	listId: number,
	rows: WordState[]
): Promise<void> {
	if (rows.length === 0) return;
	const { error } = await supabase.from('word_state').upsert(
		rows.map((row) => ({
			list_id: listId,
			word: row.word,
			box: row.box,
			last_session: row.lastSession
		})),
		{ onConflict: 'list_id,word' }
	);
	if (error) throw error;
}

export interface SessionAttempt {
	word: string;
	wasNewWord: boolean;
	correct: boolean;
	boxBefore: number;
	boxAfter: number;
	userAnswer?: string;
}

/** Logs one row per word drilled this session, scoped to one list. */
export async function insertSessionAttempts(
	supabase: SupabaseClient,
	listId: number,
	sessionIndex: number,
	attempts: SessionAttempt[]
): Promise<void> {
	if (attempts.length === 0) return;

	const { data: sessionRow, error: sessionError } = await supabase
		.from('sessions')
		.select('id')
		.eq('list_id', listId)
		.eq('session_index', sessionIndex)
		.single();
	if (sessionError) throw sessionError;

	const { error } = await supabase.from('session_attempts').insert(
		attempts.map((a) => ({
			session_id: sessionRow.id,
			list_id: listId,
			word: a.word,
			was_new_word: a.wasNewWord,
			correct: a.correct,
			box_before: a.boxBefore,
			box_after: a.boxAfter,
			user_answer: a.userAnswer ?? null
		}))
	);
	if (error) throw error;
}
