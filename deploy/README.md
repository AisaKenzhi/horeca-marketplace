# Static demo deployment (owner approval required to publish)

These files are **inert** until a host is configured and the owner explicitly
approves publishing. Nothing here creates a domain, a paid plan, a secret or a
production environment.

The app is a client-only SPA on the default demo build (without Supabase env
vars): `npm run build` writes static assets to `dist/`. The repository also
contains an opt-in, local-only Supabase account slice; see `docs/tenant-foundation.md`.
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

## Option E — serve it directly on this host (no new account, no domain)

`deploy/serve-local-demo.sh` builds `dist/` and serves it with nginx on a
**dedicated port** (default `8080`), reversibly:

```bash
./deploy/serve-local-demo.sh          # serves on 127.0.0.1:8080
./deploy/serve-local-demo.sh 8090     # a different port
```

It does **not** touch any other site, domain, certificate, DNS record or cloud
firewall rule on the host. Undo:

```bash
sudo rm /etc/nginx/sites-enabled/horeca-demo && sudo systemctl reload nginx
sudo rm -rf /var/www/horeca-demo
```

**Exposing it to the internet** is a separate, deliberate step that needs one of
(and is intentionally NOT done by the script):

- open the chosen port in the host/cloud firewall; and/or
- point a hostname at the host and add a matching `server_name`.

On this particular host only ports 22/80/443 are reachable from the internet, and
80/443 already serve an unrelated production site, so a public demo here would
require either a firewall change or a DNS record. That decision belongs to the
owner; the script stops at a local, reversible serve.

## Option F — publish under a hostname with free TLS (this host)

`deploy/serve-domain-demo.sh` serves the demo under **your** subdomain on ports
80/443 with a free Let's Encrypt certificate, **without touching any other vhost
or certificate** on the host (it matches your `server_name` only):

```bash
# after you add:  demo.spokogastro.bond  A  34.116.173.67
./deploy/serve-domain-demo.sh demo.spokogastro.bond you@example.com
```

Prerequisites (owner action):

1. Add a DNS **A** record: `<sub>.spokogastro.bond -> 34.116.173.67`.
   If the provider proxies (Cloudflare orange cloud), set it **DNS-only** so the
   HTTP-01 challenge can be served.
2. Ports 80 and 443 must be reachable from the internet (they already are here,
   because the existing site uses them).

The script builds `dist/`, installs an isolated vhost, runs `certbot --nginx`
(which edits only the matching server block), and verifies HTTPS. Undo:

```bash
sudo certbot delete --cert-name <host>
sudo rm /etc/nginx/sites-enabled/horeca-demo-domain && sudo systemctl reload nginx
sudo rm -rf /var/www/horeca-demo
```

It is still a **demo**: `noindex`, synthetic data, no backend on this build, no
real orders. The repo's opt-in local Supabase slice is not part of this static build.
