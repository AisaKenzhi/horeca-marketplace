# Static demo deployment (owner approval required to publish)

These files are **inert** until a host is configured and the owner explicitly
approves publishing. Nothing here creates a domain, a paid plan, a secret or a
production environment.

The app is a client-only SPA: `npm run build` writes static assets to `dist/`.
Deep links such as `/basket` are client routes, so the host must fall back to
`index.html` for unknown paths.

## Option A — Netlify

1. New site from the repo (or `npx netlify deploy --dir=dist`).
2. Build command `npm run build`, publish directory `dist`.
3. Copy `deploy/netlify.toml` to the repo root (or paste its `[[redirects]]`).
4. `X-Robots-Tag: noindex` keeps the demo out of search engines.

## Option B — Cloudflare Pages

1. Connect the repo; build `npm run build`, output `dist`.
2. Copy `deploy/_redirects` into `dist/` (or the publish root) so all paths
   rewrite to `index.html`.

## Option C — Vercel

1. Import the repo; framework preset Vite, output `dist`.
2. Copy `deploy/vercel.json` to the repo root.

## Option D — GitHub Pages (sub-path caveat)

A project site is served under `/<repo>/`, so set Vite `base` before building:

```bash
VITE_BASE="/<repo>/" npm run build   # if a base option is wired; otherwise set base in vite.config.ts
```

Then publish `dist/` (e.g. to a `gh-pages` branch). Add a `404.html` copy of
`index.html` for the SPA fallback.

## Safety checklist before publishing

- [ ] This is a **demo**, published with the owner's explicit approval of the
      exact commit + target + mode.
- [ ] The **demo banner** is visible on every screen.
- [ ] `noindex` is set (headers or `robots.txt`).
- [ ] No secrets, real data, analytics or external calls are added to enable the
      host.
- [ ] Rollback is agreed (delete the deployment; nothing persists server-side).
