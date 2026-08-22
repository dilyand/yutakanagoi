-- shadowing_state.box4_streak was added without the nonnegative check
-- constraint that word_state and conjugation_state already have for the
-- identical column (20260711000001_box4_growth_streak.sql) — an oversight
-- from when the shadowing tables were first created, not a deliberate
-- difference. A negative value would shorten box 4's due interval below
-- its base 16 sessions, violating the invariant
-- src/lib/drill-algorithm.ts's effectiveInterval/nextBox4Streak assume.
alter table shadowing_state add constraint shadowing_state_box4_streak_check check (box4_streak >= 0);
