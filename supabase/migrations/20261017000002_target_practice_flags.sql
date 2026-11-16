-- Flag-button reports from target practice (per item, and on the card). Used
-- to tune generation prompts, read with an npm script in the style of
-- `logs:errors` — not a per-item fix queue, and separate from error_events.
--
-- `reason` is deliberately NOT constrained: the reason vocabulary
-- (answer_wrong, unnatural, reading_wrong, other, ...) is expected to change
-- while prompts are being tuned, and a CHECK would turn each change into a
-- migration. `type` is stable, so it keeps its CHECK, matching
-- target_practice_history. `item` is null for a flag on the card itself.
create table target_practice_flags (
  id         bigint generated always as identity primary key,
  user_id    bigint not null references users (id),
  type       text not null check (type in ('word', 'kanji', 'set_phrase', 'grammar', 'contrast')),
  target_key text not null,
  phase      text,
  item       jsonb,
  reason     text not null,
  note       text,
  created_at timestamptz not null default now()
);

create index target_practice_flags_created_at_idx
  on target_practice_flags (created_at desc);

alter table target_practice_flags enable row level security;
