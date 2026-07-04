# Yutakanagoi

A PWA for running Japanese vocabulary spaced-repetition drills: SvelteKit +
Supabase + the Claude API. Multi-user (private per-user word lists behind a
single shared passphrase) — pick a user, pick or upload a word list, then
drill. See [CLAUDE.md](./CLAUDE.md) for the drill algorithm this app
implements and current-state notes for anyone (human or agent) working in
this repo, and [supabase/README.md](./supabase/README.md) for the data
layer.

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
