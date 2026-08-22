import type { SupabaseClient } from '@supabase/supabase-js';
import type { WordState } from '$lib/drill-algorithm';
import { withRetry } from '$lib/server/retry';

const PAGE_SIZE = 1000;

export interface ChunkLibraryEntry {
	chunkId: string;
	frequencyRank: number;
}

/**
 * Every verified, unflagged chunk in this user's library, in introduction
 * order. That row order *is* the frequencyRank fed to selectDrillWords —
 * new chunks are introduced oldest-recording-first, exactly as the
 * conjugation registry uses its own array index (see conjugation session
 * start's registryAsVocab).
 *
 * Sorted by the owning recording's `ingested_at` (not `recorded_on` —
 * `recorded_on` is optional and often absent in practice, while
 * `ingested_at` is always set and reflects true library-introduction
 * order) then `chunk_index`, done client-side after fetching rather than
 * via PostgREST's embedded-resource `order` param — simpler to read and
 * verify than relying on cross-resource ordering semantics, for a sort
 * that only ever runs over one user's-worth of rows. Pagination below
 * orders by `id` instead, a plain column on the queried table.
 */
export async function fetchChunkLibrary(
	supabase: SupabaseClient,
	userId: number
): Promise<ChunkLibraryEntry[]> {
	interface Row {
		chunk_id: string;
		chunk_index: number;
		shadowing_recordings: { ingested_at: string } | { ingested_at: string }[];
	}
	const rows: Row[] = [];
	let from = 0;

	for (;;) {
		const { data, error } = await withRetry(() =>
			supabase
				.from('shadowing_chunks')
				// The relationship hint (!shadowing_chunks_recording_id_fkey) is
				// required, not cosmetic: once shadowing_chunks_recording_owner_fkey
				// (the composite ownership FK — see supabase/README.md) existed
				// alongside the plain recording_id FK, PostgREST had two valid
				// routes to shadowing_recordings and refused to embed at all
				// (PGRST201) — this broke session/start outright. Naming the FK
				// explicitly is what makes an unambiguous embed possible again.
				.select(
					'chunk_id, chunk_index, shadowing_recordings!shadowing_chunks_recording_id_fkey!inner(ingested_at)'
				)
				.eq('user_id', userId)
				.is('flagged_at', null)
				.not('verified_at', 'is', null)
				.order('id')
				.range(from, from + PAGE_SIZE - 1)
		);
		if (error) throw error;

		const page = (data ?? []) as unknown as Row[];
		rows.push(...page);
		if (page.length < PAGE_SIZE) break;
		from += PAGE_SIZE;
	}

	const sorted = rows
		.map((row) => {
			// The embed can come back as an object or a one-element array
			// depending on SDK version/query shape — normalize both.
			const recording = Array.isArray(row.shadowing_recordings)
				? row.shadowing_recordings[0]
				: row.shadowing_recordings;
			return {
				chunkId: row.chunk_id,
				chunkIndex: row.chunk_index,
				ingestedAt: recording.ingested_at
			};
		})
		.sort((a, b) => {
			const byIngestedAt = a.ingestedAt.localeCompare(b.ingestedAt);
			return byIngestedAt !== 0 ? byIngestedAt : a.chunkIndex - b.chunkIndex;
		});

	return sorted.map((row, index) => ({ chunkId: row.chunkId, frequencyRank: index }));
}

interface ChunkStateRow {
	chunk_id: string;
	box: number;
	last_session: number;
	box4_streak: number;
}

/**
 * This user's shadowing progress, restricted to `libraryChunkIds` (a
 * fetchChunkLibrary result) rather than every shadowing_state row the user
 * has ever had. Re-chunking and flagging both deliberately leave old
 * chunk_ids' state rows behind, unreachably orphaned — see
 * supabase/README.md's "Accepted downside" note on why there's no FK to
 * clean them up automatically. Left unfiltered at the query level, that
 * history only ever grows across every re-chunk/flag a user's library goes
 * through, even though session/start can only ever select drill items from
 * current library chunk_ids — so the unfiltered version was transferring
 * (and paginating past 1000 rows for) data that could never be used.
 * Session/start now fetches the library first and passes its chunk ids
 * here, rather than fetching both in parallel and filtering client-side
 * afterward.
 */
// Chunked into batches, not one .in() call with every library chunk_id at
// once — a large library sends the entire id list as one query-string
// parameter, and a URL that long can be rejected by the HTTP/proxy layer
// before result pagination ever runs (unlike the other .in() in this file,
// on session/complete's attempts, which receives at most 10 items). No
// inner range() pagination needed within a batch: (user_id, chunk_id) is
// unique, so a batch of at most CHUNK_ID_BATCH_SIZE ids can never return
// more rows than that — always comfortably under PAGE_SIZE.
const CHUNK_ID_BATCH_SIZE = 100;

export async function fetchShadowingChunkStates(
	supabase: SupabaseClient,
	userId: number,
	libraryChunkIds: string[]
): Promise<WordState[]> {
	const rows: ChunkStateRow[] = [];
	for (let i = 0; i < libraryChunkIds.length; i += CHUNK_ID_BATCH_SIZE) {
		const batch = libraryChunkIds.slice(i, i + CHUNK_ID_BATCH_SIZE);
		const { data, error } = await withRetry(() =>
			supabase
				.from('shadowing_state')
				.select('chunk_id, box, last_session, box4_streak')
				.eq('user_id', userId)
				.in('chunk_id', batch)
		);
		if (error) throw error;
		rows.push(...((data ?? []) as ChunkStateRow[]));
	}

	return rows.map((row) => ({
		word: row.chunk_id,
		box: row.box,
		lastSession: row.last_session,
		box4Streak: row.box4_streak
	}));
}

/** The latest shadowing session_index this user has started, or 0 if they've never started one. */
export async function getLatestSessionIndex(
	supabase: SupabaseClient,
	userId: number
): Promise<number> {
	const { data, error } = await withRetry(() =>
		supabase
			.from('shadowing_sessions')
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
 * Thrown by insertSessionRow when another session/start call for the same
 * user is concurrently in flight — see its doc comment for why this is
 * refused outright rather than retried with a freshly re-read
 * session_index (a retry would create a second, fully valid, concurrently
 * active session built from the same stale progress snapshot, risking a
 * later completion overwriting newer box/last_session data with older
 * values). Mapped to a 409 by session/start's route handler.
 */
export class SessionAlreadyStartingError extends Error {
	constructor() {
		super('A session is already starting for this account — please wait a moment and try again.');
		this.name = 'SessionAlreadyStartingError';
	}
}

/**
 * Inserts the shadowing_sessions row for a session whose response is
 * already fully built — deliberately separate from computing the next
 * session_index (that's ShadowingContext.sessionIndex + 1, already
 * available from fetchShadowingContext at the top of session/start; no
 * second read needed). Session-start used to read-then-insert this row
 * before fetching/signing chunk details, so a failure in that later step
 * (Storage signing, a missing detail row) still left an orphaned,
 * never-completed session behind. Call this only once the response is
 * ready to return, so a failure before that point never reserves a
 * session_index it can't deliver.
 *
 * A unique-violation (Postgrest error code '23505', on shadowing_sessions'
 * (user_id, session_index) constraint) means two concurrent session/start
 * calls for the same user both computed the same "next" session_index —
 * translated to SessionAlreadyStartingError rather than left as the raw
 * Postgrest error, so the route handler can map it to a clean 409 instead
 * of an undifferentiated 500.
 */
export async function insertSessionRow(
	supabase: SupabaseClient,
	userId: number,
	sessionIndex: number
): Promise<void> {
	const { error } = await withRetry(() =>
		supabase.from('shadowing_sessions').insert({ user_id: userId, session_index: sessionIndex })
	);
	if (error?.code === '23505') throw new SessionAlreadyStartingError();
	if (error) throw error;
}

/** Marks a shadowing session complete once every chunk has been drilled. */
export async function completeSession(
	supabase: SupabaseClient,
	userId: number,
	sessionIndex: number,
	chunksDrilled: number
): Promise<void> {
	const { error } = await withRetry(() =>
		supabase
			.from('shadowing_sessions')
			.update({ completed_at: new Date().toISOString(), chunks_drilled: chunksDrilled })
			.eq('user_id', userId)
			.eq('session_index', sessionIndex)
	);
	if (error) throw error;
}

/**
 * Upserts the post-drill box/last_session for each chunk drilled this
 * session, scoped to one user. Goes through the upsert_shadowing_chunk_states
 * RPC (see its migration, 20260822050000) rather than a plain
 * supabase-js .upsert() — SessionAlreadyStartingError only stops two
 * requests racing to insert the *same* session_index; it doesn't stop a
 * sequential second session (a tab left open with an incomplete session,
 * then a new one started later) from being built off the same stale
 * progress snapshot. If that second session finishes first and the first
 * finishes later, a plain upsert would let the first session's completion
 * silently overwrite the second's newer box/last_session values with older
 * ones. The RPC's conditional ON CONFLICT only accepts a write whose
 * last_session is greater than what's already stored per chunk — since
 * every row in one batch shares this session's own session_index as its
 * last_session (see rating.ts's applyShadowingOutcome), that's exactly
 * "only a more recent session's completion may update this chunk."
 */
export async function upsertChunkStates(
	supabase: SupabaseClient,
	userId: number,
	rows: WordState[]
): Promise<void> {
	if (rows.length === 0) return;
	const { error } = await withRetry(() =>
		supabase.rpc('upsert_shadowing_chunk_states', {
			p_user_id: userId,
			p_rows: rows.map((row) => ({
				chunk_id: row.word,
				box: row.box,
				last_session: row.lastSession,
				box4_streak: row.box4Streak
			}))
		})
	);
	if (error) throw error;
}

/**
 * Thrown by verifySessionOwnership when sessionIndex doesn't match a real
 * shadowing_sessions row for this user. Mapped to a 404 by session/complete's
 * route handler.
 */
export class SessionNotFoundError extends Error {
	constructor() {
		super('No such session for this account.');
		this.name = 'SessionNotFoundError';
	}
}

/**
 * Confirms sessionIndex corresponds to a real, previously-started session
 * for this user before session/complete writes anything. Without this, the
 * client-supplied sessionIndex (and, before this fix, each row's own
 * client-supplied lastSession) was trusted outright: an authenticated
 * client could submit an arbitrary large integer as lastSession for any
 * chunk, which upsert_shadowing_chunk_states' conditional ON CONFLICT (see
 * upsertChunkStates and its migration) would then treat as genuinely
 * "more recent" than any real future session — permanently blocking every
 * legitimate future update to that chunk's state, since no real session
 * would ever reach that value. Deriving last_session from a
 * server-validated sessionIndex (done by the route handler, using this
 * check) rather than the request payload closes that off entirely: a
 * session_index can only be this large if session/start itself produced
 * it, which increments by exactly one per real session.
 *
 * insertSessionAttempts already performed an equivalent check via its own
 * .single() lookup, but only when attempts.length > 0 — an empty attempts
 * array (which the request schema permits) skipped it silently. This is
 * the one unconditional check the route handler now runs up front,
 * covering every write below it regardless of whether attempts is empty.
 */
export async function verifySessionOwnership(
	supabase: SupabaseClient,
	userId: number,
	sessionIndex: number
): Promise<void> {
	const { data, error } = await withRetry(() =>
		supabase
			.from('shadowing_sessions')
			.select('id')
			.eq('user_id', userId)
			.eq('session_index', sessionIndex)
			.maybeSingle()
	);
	if (error) throw error;
	if (!data) throw new SessionNotFoundError();
}

export interface ShadowingSessionAttempt {
	chunkId: string;
	wasNewChunk: boolean;
	hintLevel: number;
	rating: 'easy' | 'good' | 'hard' | 'very_hard';
	replays: number;
	boxBefore: number;
	boxAfter: number;
}

/** Logs one row per chunk drilled this session, scoped to one user. */
export async function insertSessionAttempts(
	supabase: SupabaseClient,
	userId: number,
	sessionIndex: number,
	attempts: ShadowingSessionAttempt[]
): Promise<void> {
	if (attempts.length === 0) return;

	const { data: sessionRow, error: sessionError } = await withRetry(() =>
		supabase
			.from('shadowing_sessions')
			.select('id')
			.eq('user_id', userId)
			.eq('session_index', sessionIndex)
			.single()
	);
	if (sessionError) throw sessionError;

	const { error } = await withRetry(() =>
		supabase.from('shadowing_session_attempts').insert(
			attempts.map((a) => ({
				session_id: sessionRow.id,
				user_id: userId,
				chunk_id: a.chunkId,
				was_new_chunk: a.wasNewChunk,
				hint_level: a.hintLevel,
				rating: a.rating,
				replays: a.replays,
				box_before: a.boxBefore,
				box_after: a.boxAfter
			}))
		)
	);
	if (error) throw error;
}

export interface ChunkDetail {
	chunkId: string;
	audioUrl: string;
	transcript: string;
	kana: string;
	translation: string;
	durationMs: number;
}

// Longer than a session, short enough a leaked URL isn't a durable
// capability — same reasoning as every other signed URL in this app.
const SIGNED_URL_TTL_SECONDS = 60 * 60 * 2;

/**
 * Fetches full chunk data (audio path, transcript, kana, translation) for
 * this session's selected chunk ids and mints a signed URL for each — the
 * app never streams shadowing audio itself, and never exposes a raw
 * Storage path to the client.
 */
export async function fetchChunkDetailsWithSignedUrls(
	supabase: SupabaseClient,
	userId: number,
	chunkIds: string[]
): Promise<ChunkDetail[]> {
	if (chunkIds.length === 0) return [];

	interface Row {
		chunk_id: string;
		audio_path: string;
		transcript: string;
		kana: string;
		translation: string;
		duration_ms: number;
	}

	const { data, error } = await withRetry(() =>
		supabase
			.from('shadowing_chunks')
			.select('chunk_id, audio_path, transcript, kana, translation, duration_ms')
			.eq('user_id', userId)
			.in('chunk_id', chunkIds)
	);
	if (error) throw error;
	const rows = (data ?? []) as Row[];

	const details = await Promise.all(
		rows.map(async (row): Promise<ChunkDetail> => {
			const { data: signed, error: signError } = await withRetry(() =>
				supabase.storage
					.from('shadowing-audio')
					.createSignedUrl(row.audio_path, SIGNED_URL_TTL_SECONDS)
			);
			if (signError || !signed) {
				throw signError ?? new Error(`Failed to sign URL for ${row.audio_path}`);
			}
			return {
				chunkId: row.chunk_id,
				audioUrl: signed.signedUrl,
				transcript: row.transcript,
				kana: row.kana,
				translation: row.translation,
				durationMs: row.duration_ms
			};
		})
	);

	// selectDrillWords already chose the presentation order; the query
	// above doesn't preserve it, so re-order by the caller's chunkIds.
	const byId = new Map(details.map((d) => [d.chunkId, d]));
	return chunkIds
		.map((id) => byId.get(id))
		.filter((detail): detail is ChunkDetail => detail !== undefined);
}

/** Sets flagged_at/flag_note, scoped to this user, and excludes the chunk from future session/start rotation. */
export async function flagChunk(
	supabase: SupabaseClient,
	userId: number,
	chunkId: string,
	note: string | undefined
): Promise<void> {
	const { error } = await withRetry(() =>
		supabase
			.from('shadowing_chunks')
			.update({ flagged_at: new Date().toISOString(), flag_note: note ?? null })
			.eq('user_id', userId)
			.eq('chunk_id', chunkId)
	);
	if (error) throw error;
}
