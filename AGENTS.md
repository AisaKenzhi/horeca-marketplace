# AGENTS.md — working rules for this repository

This file tells an automated agent (or a human) how to work safely in the
HoReCa marketplace prototype. Read it before changing code.

## What this repository is

A **private, local P0 prototype** of a B2B HoReCa procurement marketplace for
Kazakhstan. It is a client-only React + TypeScript SPA that keeps all state in
memory (optionally browser storage). There is **no backend, no database, no
network calls, and no real data**. Every value is clearly synthetic demo data.

It is **not** a live marketplace. It does not create real orders, payments,
refunds, deliveries, reservations, or messages, and it does not contact any
supplier, buyer, partner, government, bank, or payment provider.

## Hard limits (do not cross without explicit, specific permission)

- Do **not** register a company or account, apply anywhere, or contact any third
  party.
- Do **not** create real orders, payments, refunds, payouts, reservations,
  bookings, deliveries, or real tariffs.
- Do **not** use production data, credentials, or keys; do **not** connect to a
  production database or apply migrations to one.
- Do **not** deploy, publish, or create public resources; do **not** push, merge,
  release, or change a git remote without a separate instruction.
- Do **not** pay for domains or any paid service.
- Do **not** put real personal, banking, tax, commercial, or food data into
  code, fixtures, logs, screenshots, or tests.

If a task seems to require any of the above, stop and ask for explicit
permission on that one action. Otherwise proceed with a safe, reversible default
and record the assumption in `docs/`.

## Sources of truth

- The **code and the current HEAD** define actual behaviour.
- The Notion pages (`docs/product-scope.md` links the brief) are **product
  context only**; do not edit them.
- Do not treat this README or any doc as a spec that overrides the code.

## Architecture (keep it)

- `src/domain/` — pure domain rules (money, packaging, freshness, cart,
  revisions, order lifecycle, authorization, catalog import, reorder, errors).
  No I/O, no React.
- `src/data/` — the in-browser `Repository` (the single mutation point) plus
  synthetic `seed.ts`. This is the "server boundary" for the prototype: every
  permission check lives here, not only in the UI.
- `src/features/` — screens. The UI is **not** a security boundary. Never rely
  on hiding a button; re-check in the repository.
- `src/components/`, `src/app/` — shared UI, store, i18n.

Do not rewrite the app from scratch, and do not add a backend or a database
without a documented, product-justified reason.

## Rules that must stay true in code

- **Money** is integer minor units in KZT (`src/domain/money.ts`). Never use
  floating point for money.
- **Price/availability** are separate timestamped observations. Never present a
  stale or unknown value as current. A stale/changed price is a submit blocker
  that requires explicit buyer re-confirmation.
- **Sell unit, pack size, MOQ, step, supplier minimum, delivery fee, free
  threshold** are distinct fields. Never compare incompatible pack sizes without
  an exact coefficient.
- **Tenant isolation**: buyer orgs see only their own data; suppliers see only
  their own branch; a foreign id (URL or query) must return a safe
  not-found/forbidden, never a foreign object.
- **Locations**: scope by the acting membership's org. Never infer the org from
  "the first location". A supplier's delivery zone must cover the selected
  location or the group is held back with an exact reason.
- **Parent procurement + independent suborders**: persistent parent entity;
  each suborder is one supplier. Partial confirm/reject/fulfil states aggregate
  without hiding any branch.
- **Idempotency**: side-effecting operations (submit, import, reorder) accept an
  idempotency key and must not double-create. Concurrency-sensitive writes take
  an `expectedVersion` and reject on mismatch instead of overwriting.
- **Errors**: use the typed catalogue in `src/domain/errors.ts`. Never show stack
  traces, secrets, PII, SQL, or foreign object ids to the user.
- **Audit** is append-only. Correct a mistake with a compensating event, not by
  editing history.
- **TypeScript** is strict. Do not silence errors with `any`,
  `unknown as`, `@ts-ignore`, or by weakening lint rules. Validate at input
  boundaries.
- **CSV import** treats the file as plain text: bounded size/rows, no formula or
  macro execution, no silent value "fixing", atomic apply (or an explicitly
  shown partial apply) and no duplicate rows on re-import.

## Verification before you finish

Run the full local gate:

```bash
npm run verify      # prettier check is separate: npm run format
npm run format      # format check
npm run e2e         # Playwright, desktop + mobile, against local preview
```

`npm run verify` = lint → typecheck → unit tests → build. All must be green.
Playwright runs against the local preview server only, never a public host.

## Honesty about what tests prove

Local unit/component/E2E tests on synthetic data prove the **local**
implementation. They do **not** prove real demand, legal validity, food safety,
payment viability, or that any external service works. Never claim otherwise.
State clearly which of the three levels (local / staging / production) a result
belongs to.
