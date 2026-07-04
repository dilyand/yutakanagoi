-- 0.2.0 part 2: finalize list-scoping.
--
-- Do NOT apply this migration until scripts/migrate-legacy-user-list.ts has
-- been run against this database (see supabase/README.md and part 1's
-- header comment) — the not-null constraints below will fail against any
-- word_state/sessions/session_attempts row still missing a list_id, and the
-- session_attempts.session_id backfill (via the still-present session_index
-- column) must have already happened before that column is dropped here.

-- sessions: drop the FK that depends on the old session_index primary key
-- before swapping the primary key to the surrogate id column.
alter table session_attempts drop constraint session_attempts_session_index_fkey;
alter table session_attempts drop column session_index;

alter table sessions drop constraint sessions_pkey;
alter table sessions alter column id set not null;
alter table sessions add primary key (id);
alter table sessions alter column list_id set not null;
-- session_index is no longer a global primary key -- just a per-list ordinal.
alter table sessions add constraint sessions_list_session_index_key unique (list_id, session_index);

alter table session_attempts alter column session_id set not null;
alter table session_attempts add constraint session_attempts_session_id_fkey
  foreign key (session_id) references sessions (id);
alter table session_attempts alter column list_id set not null;

-- word_state / session_attempts: word FK becomes composite (list_id, word)
-- instead of a bare word -> vocab_master(word) FK, since "word" alone is no
-- longer globally unique once multiple lists exist.
alter table word_state alter column list_id set not null;
alter table word_state drop constraint word_state_word_fkey;
alter table word_state drop constraint word_state_word_key;
alter table word_state add constraint word_state_list_word_key unique (list_id, word);
alter table word_state add constraint word_state_list_word_fkey
  foreign key (list_id, word) references list_words (list_id, word);

alter table session_attempts drop constraint session_attempts_word_fkey;
alter table session_attempts add constraint session_attempts_list_word_fkey
  foreign key (list_id, word) references list_words (list_id, word);

create index session_attempts_session_id_idx on session_attempts (session_id);
create index session_attempts_list_word_idx on session_attempts (list_id, word);

drop table vocab_master;
