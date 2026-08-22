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
	box4_streak: number;
}

/** Everything selectDrillWords() needs for this user's conjugation progress, plus the latest session_index. */
export async function fetchConjugationContext(
	supabase: SupabaseClient,
	userId: number
): Promise<ConjugationContext> {
	const [cellStateRows, sessionIndex] = await Promise.all([
		fetchAllRows<CellStateRow>(
			supabase,
			'conjugation_state',
			'cell_id, box, last_session, box4_streak',
			{
				user_id: userId
			}
		),
		getLatestSessionIndex(supabase, userId)
	]);

	return {
		cellStates: cellStateRows.map((row) => ({
			word: row.cell_id,
			box: row.box,
			lastSession: row.last_session,
			box4Streak: row.box4_streak
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

/**
 * Inserts the conjugation_sessions row for a session whose response is
 * already fully built — deliberately separate from computing the next
 * session_index (that's ConjugationContext.sessionIndex + 1, already
 * available from fetchConjugationContext at the top of session/start; no
 * second read needed). Session-start used to read-then-insert this row
 * (the old startSession) before the Claude conjugation_prompt_glosses
 * call later in the same handler, so a failure there (network error,
 * malformed response, rate limit) still left an orphaned, never-completed
 * session behind. Call this only once the response is ready to return, so
 * a failure before that point never reserves a session_index it can't
 * deliver — same fix already applied to shadowing drill's session/start
 * for the identical bug class (see shadowing-repository.ts's
 * insertSessionRow).
 */
export async function insertSessionRow(
	supabase: SupabaseClient,
	userId: number,
	sessionIndex: number
): Promise<void> {
	const { error } = await withRetry(() =>
		supabase.from('conjugation_sessions').insert({ user_id: userId, session_index: sessionIndex })
	);
	if (error) throw error;
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
				last_session: row.lastSession,
				box4_streak: row.box4Streak
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
