import type { SupabaseClient } from '@supabase/supabase-js';
import type { WordState } from '$lib/drill-algorithm';
import { fetchAllRows } from '$lib/supabase-pagination';
import { withRetry } from '$lib/server/retry';

export interface ConjugationContext {
	/** WordState reused as-is: `word` holds the cell id (e.g. "godan_mu:causative_passive_past"),
	 *  not a vocabulary word — see cellId() in $lib/conjugation-forms. */
	cellStates: WordState[];
	sessionIndex: number;
}

interface CellStateRow {
	cell_id: string;
	box: number;
	last_session: number;
}

/** Everything selectDrillWords() needs for this user's conjugation progress, plus the latest session_index. */
export async function fetchConjugationContext(
	supabase: SupabaseClient,
	userId: number
): Promise<ConjugationContext> {
	const [cellStateRows, sessionIndex] = await Promise.all([
		fetchAllRows<CellStateRow>(supabase, 'conjugation_state', 'cell_id, box, last_session', {
			user_id: userId
		}),
		getLatestSessionIndex(supabase, userId)
	]);

	return {
		cellStates: cellStateRows.map((row) => ({
			word: row.cell_id,
			box: row.box,
			lastSession: row.last_session
		})),
		sessionIndex
	};
}

async function getLatestSessionIndex(supabase: SupabaseClient, userId: number): Promise<number> {
	const { data, error } = await withRetry(() =>
		supabase
			.from('conjugation_sessions')
			.select('session_index')
			.eq('user_id', userId)
			.order('session_index', { ascending: false })
			.limit(1)
			.maybeSingle()
	);
	if (error) throw error;
	return data?.session_index ?? 0;
}

/** Increments this user's conjugation session counter and inserts the new conjugation_sessions row. */
export async function startSession(supabase: SupabaseClient, userId: number): Promise<number> {
	const nextSessionIndex = (await getLatestSessionIndex(supabase, userId)) + 1;
	const { error } = await withRetry(() =>
		supabase
			.from('conjugation_sessions')
			.insert({ user_id: userId, session_index: nextSessionIndex })
	);
	if (error) throw error;
	return nextSessionIndex;
}

/** Marks a conjugation session complete once all cells have been drilled. */
export async function completeSession(
	supabase: SupabaseClient,
	userId: number,
	sessionIndex: number,
	cellsDrilled: number
): Promise<void> {
	const { error } = await withRetry(() =>
		supabase
			.from('conjugation_sessions')
			.update({ completed_at: new Date().toISOString(), cells_drilled: cellsDrilled })
			.eq('user_id', userId)
			.eq('session_index', sessionIndex)
	);
	if (error) throw error;
}

/** Upserts the post-drill box/last_session for each cell drilled this session, scoped to one user. */
export async function upsertCellStates(
	supabase: SupabaseClient,
	userId: number,
	rows: WordState[]
): Promise<void> {
	if (rows.length === 0) return;
	const { error } = await withRetry(() =>
		supabase.from('conjugation_state').upsert(
			rows.map((row) => ({
				user_id: userId,
				cell_id: row.word,
				box: row.box,
				last_session: row.lastSession
			})),
			{ onConflict: 'user_id,cell_id' }
		)
	);
	if (error) throw error;
}

export interface ConjugationSessionAttempt {
	cellId: string;
	/** The specific word drilled for this cell this attempt — not part of the
	 *  progress state itself, since progress is tracked per (word class, form). */
	word: string;
	wasNewCell: boolean;
	correct: boolean;
	boxBefore: number;
	boxAfter: number;
	userAnswer?: string;
	/** 1-3: how many tries the hint-then-retry loop took. Grading is still
	 *  based on the first attempt only — this is for later analysis. */
	attemptsUsed: number;
}

/** Logs one row per cell drilled this session, scoped to one user. */
export async function insertSessionAttempts(
	supabase: SupabaseClient,
	userId: number,
	sessionIndex: number,
	attempts: ConjugationSessionAttempt[]
): Promise<void> {
	if (attempts.length === 0) return;

	const { data: sessionRow, error: sessionError } = await withRetry(() =>
		supabase
			.from('conjugation_sessions')
			.select('id')
			.eq('user_id', userId)
			.eq('session_index', sessionIndex)
			.single()
	);
	if (sessionError) throw sessionError;

	const { error } = await withRetry(() =>
		supabase.from('conjugation_session_attempts').insert(
			attempts.map((a) => ({
				session_id: sessionRow.id,
				user_id: userId,
				cell_id: a.cellId,
				word: a.word,
				was_new_cell: a.wasNewCell,
				correct: a.correct,
				box_before: a.boxBefore,
				box_after: a.boxAfter,
				user_answer: a.userAnswer ?? null,
				attempts_used: a.attemptsUsed
			}))
		)
	);
	if (error) throw error;
}
