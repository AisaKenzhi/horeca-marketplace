# HoReCa Marketplace — P0 prototype

A private prototype of a B2B procurement marketplace for HoReCa (hotels,
restaurants, catering) suppliers and buyers. The original buyer → supplier →
explicit-decision demo still runs on **synthetic in-browser data**. An opt-in
`/account` slice adds Supabase Auth and persistent organizations, buyer locations,
supplier profiles and a small authenticated catalog when configured.

> **This is not a live marketplace.** The account slice is a technical foundation,
> not business verification or a launch. It does not create orders, process
> payments, send messages, or integrate delivery. With Supabase variables absent,
> the app makes no backend calls. The market is not empty — established players
> exist; any differentiation here is a hypothesis to test, not a claim.

---

## Quick start

```bash
npm install          # Node >= 20.19, npm >= 10
npm run dev          # http://127.0.0.1:5173
```

Open the URL and use the **"Демо-роль"** selector in the header to switch between
synthetic personas.

### Optional: Docker

```bash
docker compose up    # http://127.0.0.1:5173
```

Docker is defined for a reproducible local dev environment only.

---

## Demo walkthrough (5 minutes)

1. **Каталог** — browse offers. Each card shows the seller, the sell unit, the
   price per sell unit, the per-kg/l unit price (only when comparable), MOQ,
   order step, availability, and freshness badges. Some offers are stale and some
   have no price — they are flagged, never shown as current.
2. **Корзина** — the basket is split per supplier, each with its own subtotal,
   supplier minimum, delivery rule and status. One total is never shown as one
   bill. Where delivery is unknown it is shown as unknown, not as zero.
3. **Отправить (демо)** — pick a deliver-to location first, then create a parent
   procurement and one suborder per ready supplier. Groups below their minimum,
   with a stale price, or in a zone the supplier does not cover stay in the basket
   with an exact reason.
4. Switch the demo role to a **supplier order operator** → **Кабинет поставщика**
   → **Предложить изменение** on a suborder.
5. Switch back to the **buyer owner** → **Закупки** → open the suborder → it
   shows _"Поставщик предложил изменение"_ and **Принять изменение** /
   **Отклонить изменение**. Nothing is applied until you decide.
6. As the supplier, **Начать сборку → Готово к передаче → Отгрузить**; as the
   buyer receiver, advance to **Приёмка** and record observed discrepancies.
7. **Повторить закупку** builds a _new_ draft and re-checks live price and
   availability. Missing items are flagged, not silently dropped.

Demo personas include: café owner, café purchaser, café receiver, café viewer,
hotel owner, two suppliers (Alpha/Beta), and platform moderator/support.

---

## Scripts

| Command                 | What it does                                                     |
| ----------------------- | ---------------------------------------------------------------- |
| `npm run dev`           | Vite dev server (127.0.0.1:5173)                                 |
| `npm run build`         | Type-check + production build to `dist/`                         |
| `npm run preview`       | Serve the built app (127.0.0.1:4173)                             |
| `npm run typecheck`     | TypeScript project build (strict)                                |
| `npm run lint`          | ESLint (flat config, type-aware)                                 |
| `npm run format`        | Prettier check                                                   |
| `npm test`              | Vitest unit + component tests                                    |
| `npm run test:coverage` | Coverage for `src/domain` and `src/data` (fails below the floor) |
| `npm run e2e`           | Playwright E2E (desktop + mobile) against the preview            |
| `npm run e2e:ci`        | local mock Supabase build + Playwright (what CI runs)            |
| `npm run verify`        | lint → typecheck → test → build                                  |
| `npm run verify:full`   | format → lint → typecheck → coverage → build                     |

First E2E run may need a browser: `npm run e2e:install` (Chromium).

---

## What P0 demonstrates

- Every offer and suborder names its exact seller.
- Sell unit, pack size, price per sell unit, per-base-unit price, MOQ, order
  step, supplier minimum and free-delivery threshold are separate, explicit
  values — never conflated under one "minimum order".
- Price and availability are independent, timestamped observations. Stale or
  unknown values are flagged as needing confirmation, never presented as current.
- The basket merges for convenience but always splits into independent supplier
  suborders, each with its own conditions and states.
- Agreement, fulfillment and payment are three separate state machines; success
  in one never falsely completes another.
- Supplier-proposed changes require an explicit buyer decision **for that exact
  revision**; silence is not consent.
- Reorder creates a new draft that re-checks live price and availability.
- Demo screens collect no money and are not a public storefront.

## Hardening highlights (local, synthetic data only)

- **Tenant isolation** on every read/write boundary: procurement detail,
  decisions, receipts and parent reads are scoped to the acting buyer org or the
  owning supplier. A guessed id yields a safe not-found/forbidden.
- **Explicit deliver-to location** chosen from the acting org's locations, and
  **per-supplier delivery-zone coverage** validated before submit. Unknown or
  uncovered zones hold the group back rather than claiming delivery.
- **Stale/changed price blocks submit** and requires explicit re-confirmation.
- **Parent procurement** persisted; independent supplier suborders aggregate
  partial states without hiding any branch.
- **Idempotent** submit/import/reorder; **version-checked** supplier and buyer
  writes reject a conflicting concurrent change instead of overwriting.
- **Typed error catalogue** with safe messages; the UI never shows internal
  detail.
- **Local CSV import** that validates, previews added/updated/unchanged/error with
  a before/after diff, applies atomically and creates no duplicates on re-import.
- **Verification gates**: `npm run verify:full` and the CI workflow
  (`.github/workflows/ci.yml`) run format, lint, typecheck, unit tests with
  coverage, build and E2E. A separate `.github/workflows/supabase-db.yml` runs
  migrations, six pgTAP suites and local PostgREST/concurrency smoke scripts
  against an **ephemeral local** Postgres. Evidence level: **local only**.

## What P0 deliberately does NOT do

- No payment/checkout/escrow/split payment or financial data.
- No email/SMS/push/WhatsApp/Telegram; notifications are a local demo inbox.
- No anonymous public storefront or production deployment; explicitly published
  offers are visible only to authenticated users, and supplier review remains
  pending until an operator workflow exists.
- No logistics, routing or cold-chain features.
- Demo personas remain switches, not authentication. The optional `/account`
  route uses Supabase Auth with **local** invitations and owner/admin role
  management (invitation links are handed over manually — no email provider).
  Business identity verification and supplier review are not implemented; a
  `pending` profile is never verified.
- No XLSX/ERP/1C import (CSV only, local and validated).

See [`docs/product-roadmap.md`](docs/product-roadmap.md) for the consolidated
plan through Product Ready and launch gates. Also see `docs/product-scope.md`, `docs/adr.md`, `docs/security.md` and
[`docs/tenant-foundation.md`](docs/tenant-foundation.md) for the account, RLS and
local database setup details.
Deployability and the honest launch-gate status are in
`docs/deploy-readiness.md` (with static-host templates under `deploy/`).

---

## Project structure

```
src/
  domain/     Pure, tested business rules (money, packaging, freshness,
              cart, order lifecycle, revisions, authorization, reorder, CSV)
  data/       In-browser repository, storage wrapper, synthetic seed, Supabase access
  app/        Store/context, routing shell, i18n
  components/ Shared presentational primitives
  features/   buyer/, supplier/, operator/, session/, account/ vertical slices
supabase/     Local config, versioned SQL migrations and pgTAP RLS tests
tests/        Vitest unit + component tests and fixtures
e2e/          Playwright end-to-end scenarios
docs/         ADRs, product scope, security notes
```

## Testing

- **Unit / component (Vitest):** domain rules, repository behaviour and tenant
  isolation (IDOR/BOLA, location scope, role matrix, idempotency/concurrency,
  parent aggregation, reorder persistence, real CSV import), plus catalog UI
  behaviour.
- **E2E (Playwright):** catalog → basket grouping → location selection → submit →
  supplier change → buyer decision, reorder persistence, supplier isolation,
  guessed-id not-found, keyboard access, stale/unknown flagging. Runs on desktop
  and a mobile viewport.

Demo state lives in memory for the page lifetime; when configured, the separate
`/account` workspace persists data in Supabase. E2E demo tests navigate with in-app
links because a full page reload resets demo state.

## Configuration

Copy `.env.example` to an ignored `.env.local` for local overrides. Vite-prefixed
values are shipped to the browser; Supabase settings may contain only the project
URL and public anon/publishable key, never a service-role or secret key.

- `VITE_DEFAULT_LOCALE` (default `ru`)
- `VITE_STALENESS_HOURS` (default `24`)

Without `VITE_SUPABASE_URL` and either `VITE_SUPABASE_PUBLISHABLE_KEY` or the
legacy `VITE_SUPABASE_ANON_KEY`, `/account` explains that the optional backend is
not configured and the app stays in demo mode. With a URL and one of those public
keys, that route uses Supabase Auth and RLS-backed data. Local database setup and
the tenant security model are documented in `docs/tenant-foundation.md`; no hosted
database has been linked or migrated.

## Status and limits

- P0 prototype. Not a product, not a launch, not a claim of uniqueness.
- The seed data, prices, addresses and organisations are fictional.
- Accessibility targets WCAG 2.2 AA for the main buyer flow; this has **not**
  been through a formal audit.
- The Kazakh locale is a scaffold that currently falls back to Russian.
- Business and legal decisions (city, segment, operator, monetisation,
  payments, real suppliers) remain open and are listed in
  `docs/product-scope.md`.
