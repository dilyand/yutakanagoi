-- 1.2.0 prep: rename sessions/session_attempts -> vocab_sessions/vocab_session_attempts.
--
-- Unlike word_state/word_lists/list_words, these two names carry no
-- vocab-specific token -- a reader can't tell from the name alone that
-- they're vocab-drill-scoped. Renaming now, before conjugation drills add
-- their own conjugation_sessions/conjugation_session_attempts tables,
-- avoids ever shipping a confusing asymmetric state where "sessions" looks
-- generic/shared but isn't.
--
-- Pure rename: no columns, data, or constraint/RLS semantics change, only
-- names. Constraint/index/sequence names below were introspected from the
-- local dev stack (`npx supabase start` + pg_constraint/pg_indexes/pg_depend)
-- rather than assumed, since Postgres does not auto-rename an object's
-- constraints, indexes, or identity sequences when the owning table itself
-- is renamed.

alter table sessions rename to vocab_sessions;
alter table session_attempts rename to vocab_session_attempts;

alter table vocab_sessions rename constraint sessions_list_id_fkey
  to vocab_sessions_list_id_fkey;
alter table vocab_sessions rename constraint sessions_list_session_index_key
  to vocab_sessions_list_session_index_key;
alter table vocab_sessions rename constraint sessions_pkey
  to vocab_sessions_pkey;

alter table vocab_session_attempts rename constraint session_attempts_box_after_check
  to vocab_session_attempts_box_after_check;
alter table vocab_session_attempts rename constraint session_attempts_box_before_check
  to vocab_session_attempts_box_before_check;
alter table vocab_session_attempts rename constraint session_attempts_list_id_fkey
  to vocab_session_attempts_list_id_fkey;
alter table vocab_session_attempts rename constraint session_attempts_list_word_fkey
  to vocab_session_attempts_list_word_fkey;
alter table vocab_session_attempts rename constraint session_attempts_pkey
  to vocab_session_attempts_pkey;
alter table vocab_session_attempts rename constraint session_attempts_session_id_fkey
  to vocab_session_attempts_session_id_fkey;

alter index session_attempts_list_word_idx rename to vocab_session_attempts_list_word_idx;
alter index session_attempts_session_id_idx rename to vocab_session_attempts_session_id_idx;
alter index session_attempts_word_idx rename to vocab_session_attempts_word_idx;

alter sequence sessions_id_seq rename to vocab_sessions_id_seq;
alter sequence session_attempts_id_seq rename to vocab_session_attempts_id_seq;
