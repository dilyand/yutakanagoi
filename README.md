# Yutakanagoi

A PWA for Japanese drill practice: SvelteKit + Supabase + the Claude API.
Multi-user (private per-user word lists, each user logging in with their
own username + password), with two drill activities — spaced-repetition
vocabulary drills (pick or upload a word list, then drill) and conjugation
drills (a shared word-class/form registry, not per-user lists). See
[CLAUDE.md](./CLAUDE.md) for the algorithms each activity implements and
current-state notes for anyone (human or agent) working in this repo,
[supabase/README.md](./supabase/README.md) for the data layer, and
[CHANGELOG.md](./CHANGELOG.md) for what's shipped release by release.

## Developing

Needs a local Supabase stack and a `.env` file (copy `.env.example`, then
fill in `ANTHROPIC_API_KEY` — `npx supabase start` prints the local
`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` values to fill in too):

```sh
npm install
npx supabase start                        # starts the local Supabase stack
npm run add-user -- <name> <password>     # users are created out-of-band, never via the UI
npm run set-password -- <name> <password> # to change an existing user's password later
npm run dev -- --open
```

## Testing & linting

```sh
npm run test    # vitest
npm run check   # svelte-check
npm run lint    # prettier + eslint
```

## Building

```sh
npm run build
npm run preview
```

Deploys to Vercel via `@sveltejs/adapter-vercel`, connected through Vercel's
GitHub integration (no `vercel.json` in this repo) — see CLAUDE.md's
Operating conventions section for the full deploy/PR-preview workflow.

## Credits

Word lookup in target practice uses [JMdict](https://www.edrdg.org/wiki/index.php/JMdict-EDICT_Dictionary_Project),
the property of the [Electronic Dictionary Research and Development Group](https://www.edrdg.org/),
used under their [licence](https://www.edrdg.org/edrdg/licence.html)
(Creative Commons Attribution-ShareAlike 4.0). It is loaded into the
`dictionary_entries` table by `npm run dictionary:import` from the
[jmdict-simplified](https://github.com/scriptin/jmdict-simplified) conversion;
see [supabase/README.md](./supabase/README.md). The word picker shows the same
credit on screen.
