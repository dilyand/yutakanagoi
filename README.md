# Yutakanagoi

A PWA for running Japanese vocabulary spaced-repetition drills, replacing the
markdown-driven Claude Code workflow. See [CLAUDE.md](./CLAUDE.md) for the
drill algorithm this app implements, and the linked plan/issues for the full
migration.

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
