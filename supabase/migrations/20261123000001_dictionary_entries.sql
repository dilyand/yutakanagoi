-- Target practice's Word lookup dictionary: a slimmed copy of JMdict (the
-- jmdict-simplified conversion), replacing the Word candidate model call.
-- Purely additive — old code ignores a table it doesn't reference, so this can
-- go to staging/production before the code that reads it merges.
--
-- JMdict is the property of the Electronic Dictionary Research and Development
-- Group, used under their licence (CC BY-SA 4.0); the credit line is in README.md.
--
-- Reference data, not user data: no user_id, no FK to users, read only by the
-- server (service role) and loaded by `npm run dictionary:import`. Re-running
-- the import writes only new and changed entries and deletes those the file no
-- longer has, so an entry JMdict removes disappears here too.
create table dictionary_entries (
  id           bigint primary key,   -- JMdict ent_seq
  common       boolean not null,     -- any form carries JMdict's common-priority flag
  kanji        jsonb not null,       -- [{text, common, tags}]
  kana         jsonb not null,       -- [{text, common, tags, appliesToKanji?}]
  senses       jsonb not null,       -- [{pos, misc, glosses, appliesToKanji?}]
  lookup_keys  text[] not null,      -- NFKC-folded text of every kanji and kana form
  dict_version text not null         -- dictDate of the release that last changed the row
);

-- Lookup is "which entries have this exact form": `lookup_keys @> array[$1]`.
create index dictionary_entries_lookup_keys_idx
  on dictionary_entries using gin (lookup_keys);

alter table dictionary_entries enable row level security;
