import type { SupabaseClient } from '@supabase/supabase-js';
import type { VocabEntry, WordState } from '$lib/drill-algorithm';
import { fetchAllRows } from '$lib/supabase-pagination';

export interface DrillContext {
	vocabMaster: VocabEntry[];
	wordStates: WordState[];
	sessionIndex: number;
}

interface VocabMasterRow {
	word: string;
	frequency_rank: number;
}

interface WordStateRow {
	word: string;
	box: number;
	last_session: number;
}

/** Everything selectDrillWords() needs, plus the current (latest) session_index. */
export async function fetchDrillContext(supabase: SupabaseClient): Promise<DrillContext> {
	// vocab_master has 2000 rows and word_state will grow over time — both can exceed
	// PostgREST's default max_rows (1000), so these paginate rather than plain .select().
	const [vocabMasterRows, wordStatesRows, sessionIndex] = await Promise.all([
		fetchAllRows<VocabMasterRow>(supabase, 'vocab_master', 'word, frequency_rank'),
		fetchAllRows<WordStateRow>(supabase, 'word_state', 'word, box, last_session'),
		getLatestSessionIndex(supabase)
	]);

	return {
		vocabMaster: vocabMasterRows.map((row) => ({
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

async function getLatestSessionIndex(supabase: SupabaseClient): Promise<number> {
	const { data, error } = await supabase
		.from('sessions')
		.select('session_index')
		.order('session_index', { ascending: false })
		.limit(1)
		.maybeSingle();
	if (error) throw error;
	return data?.session_index ?? 0;
}

/** Increments the global session counter and inserts the new sessions row. */
export async function startSession(supabase: SupabaseClient): Promise<number> {
	const nextSessionIndex = (await getLatestSessionIndex(supabase)) + 1;
	const { error } = await supabase.from('sessions').insert({ session_index: nextSessionIndex });
	if (error) throw error;
	return nextSessionIndex;
}

/** Marks a session complete once all words have been drilled. */
export async function completeSession(
	supabase: SupabaseClient,
	sessionIndex: number,
	wordsDrilled: number
): Promise<void> {
	const { error } = await supabase
		.from('sessions')
		.update({ completed_at: new Date().toISOString(), words_drilled: wordsDrilled })
		.eq('session_index', sessionIndex);
	if (error) throw error;
}

/** Upserts the post-drill box/last_session for each word drilled this session. */
export async function upsertWordStates(supabase: SupabaseClient, rows: WordState[]): Promise<void> {
	if (rows.length === 0) return;
	const { error } = await supabase.from('word_state').upsert(
		rows.map((row) => ({ word: row.word, box: row.box, last_session: row.lastSession })),
		{ onConflict: 'word' }
	);
	if (error) throw error;
}

export interface SessionAttempt {
	sessionIndex: number;
	word: string;
	wasNewWord: boolean;
	correct: boolean;
	boxBefore: number;
	boxAfter: number;
	userAnswer?: string;
}

/** Logs one row per word drilled this session. */
export async function insertSessionAttempts(
	supabase: SupabaseClient,
	attempts: SessionAttempt[]
): Promise<void> {
	if (attempts.length === 0) return;
	const { error } = await supabase.from('session_attempts').insert(
		attempts.map((a) => ({
			session_index: a.sessionIndex,
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
