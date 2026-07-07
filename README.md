# Yutakanagoi

A PWA for Japanese drill practice: SvelteKit + Supabase + the Claude API.
Multi-user (private per-user word lists behind a single shared passphrase),
with two drill activities — spaced-repetition vocabulary drills (pick a
user, pick or upload a word list, then drill) and conjugation drills (a
shared word-class/form registry, not per-user lists). See
[CLAUDE.md](./CLAUDE.md) for the algorithms each activity implements and
current-state notes for anyone (human or agent) working in this repo, and
[supabase/README.md](./supabase/README.md) for the data layer.

## Developing

```sh
npm install
npm run dev -- --open
```

## Building

```sh
npm run build
npm run preview
```

Deploys to Vercel via `@sveltejs/adapter-vercel`.
