-- 3.2.0: target practice, yutakanagoi's fourth activity (design:
-- notes/target-practice-design.md, local-only). This is the first of three
-- purely additive migrations — old code ignores tables it doesn't reference,
-- so all three can be applied to staging/production before any app code that
-- uses them merges.
--
-- Recent-targets list. One row per (user, type, resolved target): relaunching
-- a recent target reuses the stored card and skips the candidate + card
-- Claude calls. target_key is the canonical resolved target ('〜かどうか', not
-- the learner's English phrasing). History only — no counts, no scores; the
-- activity is learner-led and keeps no Leitner state. Written after generation
-- succeeds (the upsert bumps last_practiced_at) and pruned to 30 rows per user
-- by the repository on write.
--
-- Plain FK to users, no ON DELETE CASCADE — same as every other FK in this
-- schema (see supabase/README.md "Migration gotchas: no FK here cascades").
create table target_practice_history (
  user_id           bigint not null references users (id),
  type              text not null check (type in ('word', 'kanji', 'set_phrase', 'grammar', 'contrast')),
  target_key        text not null,
  card              jsonb not null,
  last_practiced_at timestamptz not null default now(),
  primary key (user_id, type, target_key)
);

-- The recents list orders by recency per user; the PK only covers lookup by
-- (user_id, type, target_key).
create index target_practice_history_recent_idx
  on target_practice_history (user_id, last_practiced_at desc);

alter table target_practice_history enable row level security;
