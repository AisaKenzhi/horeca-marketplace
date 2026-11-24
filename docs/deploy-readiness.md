# Deploy readiness and launch gates (P0)

> **Snapshot scope:** The launch gates, release-candidate details, deployment
> claims, and verification results below describe `da8f42a` on post-hardening
> `main`; they are historical, not a current assessment of
> `feat/product-ready-tenant-foundation-2026-11-23`. That feature branch adds an
> opt-in Supabase tenant/catalog foundation and local database tests (see
> [tenant foundation](tenant-foundation.md)). Its existence and tests do not
> mean the branch was deployed or change what this RC snapshot records.

**Addendum (current HEAD `467dcb4`):** the gates below describe only the
`da8f42a` static-demo snapshot. Current HEAD adds an opt-in **local** Supabase
slice (RLS, grants, RPC, six pgTAP suites, local CI). G4/G6/G7/G13 must therefore
be read as "demo build" vs "local Supabase only"; no hosted database, staging
environment or production deployment exists, and the **NO-GO** conclusion is
unchanged. Evidence level: **local**.

This is the honest status at that snapshot commit of what could be deployed and
what could **not**. It separates three levels the project uses everywhere:
**local** (that repo state, synthetic data), **staging** (does not exist yet),
and **production (live)** (not permitted yet).

> Bottom line: the repo is a **deployable static demo**, not a launchable
> marketplace. There is no backend, no real auth, no payments, no legal operator
> and no staging environment. A public production launch is **NO-GO**.

## 1. What "deploy" can mean here

### 1a. Static demo (technically ready, needs owner approval to publish)

The build emits a client-only SPA in `dist/`. Hosting it shows the synthetic
demo. It makes no network calls, needs no secrets, and creates no orders.

Requirements to publish a demo:

- a static host (any of: GitHub Pages, Cloudflare Pages, Netlify, Vercel);
- SPA history fallback so deep links such as `/basket` do not 404
  (rewrite everything to `index.html`);
- if hosted under a sub-path (e.g. GitHub Pages project site) set Vite `base`;
- a clear "demo / synthetic data" banner (already in the app) and `noindex`;
- **owner approval** — publishing is a public action the brief reserves.

This work does **not** publish anything and does **not** create a domain or a
paid plan.

### 1b. Real marketplace (NOT ready)

A real product needs everything issue #3 and the launch gates describe: a
server-side authn/authz boundary, a database with tenant isolation and RLS, real
supplier data, a payment/delivery decision with a real provider, and a legal
operator. None of these exist.

## 2. Deployable artifact

| Field         | Value                                                                   |
| ------------- | ----------------------------------------------------------------------- |
| Build         | `npm run build` → `dist/` (static assets only)                          |
| Server needed | none (static); no environment variables are required for the demo       |
| Secrets       | none — the demo reads no secret; `.env.example` holds placeholders only |
| Runtime calls | none — no fetch/XHR/WebSocket in `src/`                                 |
| Owner action  | review + explicitly approve publishing the exact commit and target      |

## 3. Recommended demo deployment (prepared, not executed)

Static-host config templates live next to this doc:

- `deploy/netlify.toml` — build + SPA redirect + `noindex` header.
- `deploy/_redirects` — Cloudflare Pages / Netlify fallback rule.
- `deploy/vercel.json` — rewrites + `X-Robots-Tag: noindex`.
- `deploy/README.md` — step-by-step for each host, and the base-path caveat.
- `.github/workflows/deploy-demo.yml` — **manual-only** GitHub Pages publish of
  the synthetic demo. It never runs on push (needs `workflow_dispatch` with the
  confirmation phrase `publish-demo`), builds with the project sub-path base,
  adds `404.html` + `robots.txt`, and deploys to Pages. Free, no domain, no
  secrets. Enable by setting the repo's Pages source to "GitHub Actions", then
  run the workflow manually.

These are inert until a host is configured and the owner approves the publish.

### Known blocker for a free public publish

The repository is **private**. GitHub Pages on a private repository requires a
**paid** GitHub plan to serve the site, and a Pages URL is public anyway. So the
GitHub Pages workflow above is prepared but cannot be a free public host here.

To publish the synthetic demo for free, one of these (each creating an external
account or paid resource) must be done by the owner:

1. A free-tier static host account (Cloudflare Pages / Netlify / Vercel) — uses
   `deploy/netlify.toml`, `deploy/_redirects` or `deploy/vercel.json`; or
2. A paid GitHub plan, then Settings → Pages → Source: GitHub Actions, then run
   the `Deploy static demo` workflow with the phrase `publish-demo`.

No account, domain or paid plan was created by this work.

## 4. Launch gates (P0) — status

Legend: PASS = verified in this repo with evidence; FAIL = known gap; NOT
VERIFIED = cannot be checked here (no environment/access).

| Gate | Area                                    | Status           | Evidence / owner next step                                    |
| ---- | --------------------------------------- | ---------------- | ------------------------------------------------------------- |
| G1   | Build & tests green (local)             | **PASS**         | `npm run verify:full`, E2E 18 × desktop+mobile                |
| G2   | No runtime advisories                   | **PASS**         | `npm audit` = 0                                               |
| G3   | No secrets in repo                      | **PASS**         | only `.env.example` placeholders; scan clean                  |
| G4   | No network calls in client              | **PASS**         | grep + code review; demo is hermetic                          |
| G5   | Tenant isolation (client model)         | **PASS (local)** | repository tests incl. per-org baskets                        |
| G6   | Server-side authn/authz                 | **FAIL**         | no backend; personas are a demo switch                        |
| G7   | Database + RLS                          | **FAIL**         | issue #3, not implemented                                     |
| G8   | Real supplier SKU/price/stock           | **FAIL**         | synthetic seed only                                           |
| G9   | Payments / delivery provider            | **FAIL**         | contract + mock only; no live adapter                         |
| G10  | Legal operator / contracts / taxes      | **NOT VERIFIED** | owner + competent counsel; not an engineering call            |
| G11  | Demand validated                        | **NOT VERIFIED** | owner research; local tests prove nothing about demand        |
| G12  | Staging environment                     | **FAIL**         | does not exist                                                |
| G13  | Backup / restore drill                  | **FAIL**         | no database; nothing to back up                               |
| G14  | Monitoring / alerting / on-call         | **FAIL**         | none configured                                               |
| G15  | Accessibility (WCAG 2.1 A/AA automated) | **PASS (local)** | axe gate over all screens; manual pass outstanding            |
| G16  | Privacy / retention policy              | **FAIL**         | no real data collected yet; policy is an owner/legal decision |
| G17  | Release candidate frozen & approved     | **FAIL**         | below prepared; owner approval pending                        |

## 5. Release candidate (prepared for owner decision)

An RC is provided so the owner can decide on a **demo** publish. It is **not**
a production release.

| Field          | Value                                                                                                |
| -------------- | ---------------------------------------------------------------------------------------------------- |
| Commit         | `da8f42a` (post-hardening `main`; local synthetic demo)                                              |
| Artifact       | `dist/` from `npm run build`                                                                         |
| Target         | a static host, owner's choice; a **live public demo** is served on the owner's subdomain (see below) |
| Operating mode | **public read-only synthetic demo** — no accounts, no orders, no data collection                     |
| Rollback       | delete the static deployment; nothing persists server-side                                           |
| Approve by     | owner, explicitly, naming commit + target + mode                                                     |

**Live demo (this host).** The owner pointed `demo.spokogastro.bond` at this
machine and it now serves the static demo over HTTPS with a free Let's Encrypt
certificate, via `deploy/serve-domain-demo.sh`. The vhost matches only that
hostname, so the pre-existing, unrelated production site on the same host is
untouched. Verified from the public internet: `GET https://demo.spokogastro.bond/`
and SPA deep links return 200 with `X-Robots-Tag: noindex, nofollow`; 18/18
Playwright buyer-flow scenarios (desktop + mobile) and the axe WCAG 2.1 A/AA gate
pass **against the public URL**. Still a demo: synthetic data, in-memory state,
no backend, no real orders. A local, reversible serve is also available via
`deploy/serve-local-demo.sh`.

Verified at this commit: `npm run verify:full` (lint 0 errors, typecheck, 183
tests, coverage 87.37 / 77.65 / 92.36 / 89.94, build) and Playwright E2E
(20 scenarios × desktop + mobile, incl. the axe WCAG 2.1 A/AA gate). `npm audit`
= 0. These are **local, synthetic-data** results only.

## 6. What must be true before a real launch (not just a demo)

1. A server-side boundary enforcing every check the repository enforces today,
   plus RLS tested per role and per tenant.
2. A legal operator identified and the platform's contractual role chosen by
   competent counsel.
3. Real supplier onboarding with verified SKU, price, availability, units, MOQ,
   delivery zones; a real support/dispute process.
4. A chosen payment and delivery model with the provider's written terms for the
   target territory, tested in sandbox with idempotency and refunds.
5. A staging environment, migrations with rollback, backup + restore drill,
   monitoring and an incident process.
6. Owner-confirmed demand evidence for the chosen city/segment/category.

Only then can a production GO be considered, and still only after the owner
approves the exact commit + domain + operating mode.
