-- 2.2.1: box 4's due interval now grows linearly (+1 session per
-- consecutive correct review while still at box 4, reset to 0 the moment a
-- word drops out of box 4) instead of staying flat at 16 sessions forever —
-- see src/lib/drill-algorithm.ts's effectiveInterval/nextBox4Streak and
-- CHANGELOG.md. Single-step additive: the default backfills existing rows
-- to 0, which reproduces today's flat-16 behavior exactly, so no separate
-- finalize migration is needed.

alter table word_state add column box4_streak smallint not null default 0 check (box4_streak >= 0);
alter table conjugation_state add column box4_streak smallint not null default 0 check (box4_streak >= 0);
