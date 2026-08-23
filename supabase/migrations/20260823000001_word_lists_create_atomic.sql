-- createWordList (src/lib/server/user-list-repository.ts) previously did the
-- word_lists insert and the list_words insert as two separate supabase-js
-- calls. If the second failed after the first succeeded (network blip,
-- transient error survived by withRetry only up to its own limit), the
-- word_lists row was left behind with zero words — an orphaned list a user
-- has no way to see or remove, and one that can silently absorb a *later*
-- upload attempt's "update" confirmation instead of that update reaching
-- the user's real, existing list (see CHANGELOG for the hello-talk /
-- hellotalk-words incident this caused in production). Same bug class as
-- publish_shadowing_recording (20260822000001) and the conjugation_sessions
-- fix in 5e1805c. This wraps both writes in one transaction so a partial
-- failure can't happen: either the whole list lands, or none of it does.
--
-- Unique-violation on word_lists(user_id, name) is left to propagate
-- naturally (SQLSTATE 23505) so createWordList's existing
-- ListNameConflictError mapping keeps working unchanged.
--
-- Learning from 20260822010000 (which had to revoke a default PUBLIC
-- execute grant in a follow-up migration): grant/revoke are set correctly
-- in this same migration, so there's never a window where anon/authenticated
-- could invoke a security definer function meant only for service_role.
create or replace function create_word_list(
	p_user_id bigint,
	p_name text,
	p_words text[]
) returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
	v_list_id bigint;
begin
	insert into word_lists (user_id, name)
	values (p_user_id, p_name)
	returning id into v_list_id;

	insert into list_words (list_id, word, frequency_rank)
	select v_list_id, word, ordinality
	from unnest(p_words) with ordinality as t(word, ordinality);

	return v_list_id;
end;
$$;

revoke execute on function create_word_list(bigint, text, text[]) from public;
revoke execute on function create_word_list(bigint, text, text[]) from anon, authenticated;
grant execute on function create_word_list(bigint, text, text[]) to service_role;
