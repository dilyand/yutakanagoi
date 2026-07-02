# Yutakanagoi — Japanese vocabulary drill tool

This is not an app. It's a set of plain-text files that Claude Code reads and writes
directly to run spaced-repetition vocabulary drill sessions, synced through GitHub
so state survives across devices and sessions.

## Files

- `vocab-master.md` — the full target vocabulary list. Rarely changes. Source of truth
  for what words exist.
- `vocab-state.md` — tracks only words that have been drilled at least once. Schema:

  ```
  session_index: <integer>

  word       | box | last_session
  持つ        | 2   | 12
  食べる      | 0   | 14
  ```

  - `box`: integer 0–4 (Leitner-style level). 0 = new/just failed, 4 = mastered.
  - `last_session`: the `session_index` value when the word was last drilled (not a
    date — sessions are irregular, so "sessions since last seen" is the only clock
    that matters).
  - `session_index`: one counter for the whole project, incremented once per session
    (not per word).
  - Words not yet in this file are implicitly "not yet introduced" — derive that by
    diffing against `vocab-master.md`. Don't track untouched words here.

Keep state minimal — no timestamps, no per-attempt history, no logged example
sentences. Just word, box, last_session, plus the session_index counter.

## Session algorithm

At the start of a session:

1. Increment `session_index`.
2. Compute "due" words from `vocab-state.md` using this interval table:
   - box 0: due every session
   - box 1: due every 2 sessions
   - box 2: due every 4 sessions
   - box 3: due every 8 sessions
   - box 4: due every 16 sessions (flat interval — doesn't keep growing)
   A word is due if `(session_index - last_session) >= interval(box)`.
3. Sort due words lowest-box-first (weakest gets priority), take up to 10.
4. If fewer than 10 due words exist, fill remaining slots with new words from
   `vocab-master.md` that aren't yet in `vocab-state.md`.
5. Don't force box 4 words back in early just to fill a slot.

## Drill loop (per word, within a session)

1. Present the word one at a time (the user may ask to use it in a sentence instead
   of just testing recall). If this is a new word (not yet in `vocab-state.md`), do
   not reveal its meaning — let the user guess first, same as a review word.
2. If the user demonstrates knowledge (recall the meaning / use it correctly) →
   `box += 1` (max 4), move to next word.
3. If the user doesn't know it or gets it wrong → explain the word, ask them to write
   a sentence using it, evaluate the sentence, then set `box = 0`, move on.
4. Update `last_session = current session_index` for the word regardless of outcome.
5. If the word wasn't previously in `vocab-state.md`, add it (box 0, or box 1 if the
   user got it right immediately on first exposure).

No narration: don't list the session's due/new words up front, and don't give
progress updates (box changes, counts like "3/10 done", interval math) between
words. Keep each turn to the interaction itself — prompt, guess, then explain/
correct/ask-for-a-sentence only if needed — and move straight to the next prompt.

## Git sync protocol

At the start of every session:

1. Run `git pull` before reading `vocab-state.md`, to make sure you're reading the
   latest state (it may have been updated from a different device/session).
2. If pull reports local changes that would be overwritten, stop and tell the user —
   don't force-resolve silently.

At the end of every session:

1. Write the updated `vocab-state.md` to disk.
2. `git add vocab-state.md`
3. `git commit -m "session <session_index>: <brief summary, e.g. 'drilled 10 words,
   3 moved to box 0'>"`
4. `git push` directly to main — no branches, no PRs.
5. Confirm the push succeeded before telling the user the session is done — if it
   fails (e.g. network issue, conflict), tell them explicitly rather than reporting
   success.

Only `vocab-state.md` gets committed automatically like this. If `vocab-master.md` or
`CLAUDE.md` need changes, ask the user first before committing those.
