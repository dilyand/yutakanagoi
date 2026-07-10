-- Finalize step of the 2.2.0 per-user-auth cutover (see
-- 20260710000001_user_password_sessions.sql and supabase/README.md).
-- Every user row on both staging and production now has a password_hash,
-- backfilled via scripts/set-password.ts and confirmed by a working login
-- on each environment — safe to enforce NOT NULL now.

alter table users alter column password_hash set not null;
