# Architecture Decision Records (ADR)

Short records of the decisions with a high cost to reverse. Each is a hypothesis
or a reversible choice, not a final business decision.

## ADR-0001 — Client-only prototype, no backend, no database

**Status:** Accepted for P0.

**Context.** The brief asks for a private, local P0 prototype on synthetic data
with no production integrations, no real orders, payments or messages, and no
remote database. The founder is in Poland and cannot yet have a company, so no
operator, licensing, payment or contract model is settled.

**Decision.** Build a React + TypeScript single-page app that keeps all demo
state in memory (optionally browser storage) and performs no network calls. The
tests, seed data and Playwright runs all execute locally.

**Consequences.**

- Zero risk of touching real data or services.
- No server-side authorization today; the domain policy functions are the
  enforcement point and are unit-tested for cross-tenant leakage.
- When a real backend is added (see ADR-0002), every repository method must move
  behind a tenant-checked server boundary.

## ADR-0002 — Domain rules live in pure, tested modules

**Status:** Accepted.

**Context.** Money, packaging, freshness, cart grouping, revisions and lifecycle
transitions are the parts most likely to be got subtly wrong and the parts a
future backend must share.

**Decision.** Put them in `src/domain/**` as pure functions with unit tests.
The UI and the repository call them; neither re-implements the rules.

**Consequences.**

- Rules are testable without a browser or database.
- The same functions can be reused server-side later.
- Avoids duplicated "minimum order" or "price" logic drifting between screens.

## ADR-0003 — Money as integer minor units

**Status:** Accepted.

**Context.** KZT has no minor unit in common use, so whole tenge is the integer
unit. Binary floating point is unacceptable for prices and totals.

**Decision.** `Money` is `{ amount: integer, currency }`. Arithmetic goes through
`src/domain/money.ts`. Non-integer amounts throw.

**Consequences.**

- No rounding drift in totals.
- Formatting is centralised.
- Future currencies with minor units are modelled by changing the unit meaning,
  not the algorithm.

## ADR-0004 — Independent supplier suborders under one parent procurement

**Status:** Accepted.

**Context.** A basket may mix suppliers for convenience, but each supplier has
its own minimums, delivery, price and agreement.

**Decision.** Submitting a basket creates a `ParentProcurement` and one
`SupplierSuborder` per READY supplier group. Unready groups stay in the basket.
Each suborder has its own agreement status, fulfillment status and payment
status.

**Consequences.**

- No single "cart total" is ever shown as one bill or payment.
- One supplier's minimum does not block another supplier's submission.
- Concurrency guards (a `version` field) protect a suborder edited by both sides.

## ADR-0005 — Explicit buyer decision per revision

**Status:** Accepted.

**Context.** Suppliers may propose changes; the brief forbids silent application
and treats non-response as non-consent.

**Decision.** Any change creates a new `SuborderRevision` with before/after and
author. A revision only binds after a `BuyerDecision` for that exact revision.
Superseded revisions cannot be decided. `snapshotFromRevision` produces the
immutable confirmed lines.

**Consequences.**

- Trial/trace of every change and decision.
- No auto-confirmation anywhere.
- **Deliberate, reversible product choice:** editing a basket line's _quantity_
  re-baselines that line's `addedAtPriceSnapshot` to the current live price
  (an explicit act of intent resets the reminder), while the separate price
  freshness badge still flags a stale/unknown price. This is pinned by a
  repository test; if the choice is reversed, that test changes with it.

## ADR-0006 — No payment, messaging, or publishing in P0

**Status:** Accepted.

**Context.** Payment, messaging channels, public catalog and legal operator are
unresolved business/legal decisions.

**Decision.** Payment stays `not_processed`. Notifications are local demo inbox
records only. The storefront is `draft_demo`. All external-facing affordances are
demo stubs.

**Consequences.**

- Nothing can accidentally transact.
- These features need separate product, legal and integration work later.

## ADR-0007 — Localisation scaffold, Russian default

**Status:** Provisional.

**Context.** The brief asks not to hard-code user text and to prepare for Russian
and Kazakh, while leaving terminology reviewable.

**Decision.** All UI text comes from `src/app/i18n.ts`. Russian is the demo
default (a reversible assumption). Kazakh is a scaffold that currently falls back
to Russian.

**Consequences.**

- Adding a locale is a data change, not a code change.
- Terminology and translations still need review before launch.

## ADR-0008 — Parent procurement entity and independent suborders

**Status:** Accepted for P0 hardening.

**Context.** The original P0 stored a `procurementId` on each suborder but never
persisted a parent record, so a buyer could not see which independent supplier
suborders belonged to one submit action, and partial states could not be
aggregated honestly.

**Decision.** Add a persisted `ParentProcurement` (`RepositoryState.parents`).
`submitBasket` creates the parent and its ready suborders in a single commit.
The parent status is a derived roll-up (confirmed only when every branch is
confirmed, `partially_confirmed` when some are, never hiding a branch). A
readiness preview (`submitPreview`) returns which supplier groups would submit
and which stay in the basket with an exact reason.

**Consequences.**

- One submit action can no longer create orphan suborders without a parent.
- Repeated submit with the same idempotency key replays the prior result.
- A real backend must model the same parent/child relationship with a foreign
  key and a transaction.

## ADR-0009 — Typed error catalogue and idempotency/versioning

**Status:** Accepted for P0 hardening.

**Context.** Prototype failures previously threw plain `Error` with English
messages and no stable code, and side-effecting operations could be repeated by a
double click or an unclear timeout.

**Decision.** Introduce `src/domain/errors.ts` with a stable `ErrorCode` set and
an `AppError` whose `message` is safe to render. Side-effecting repository
operations accept an idempotency key; concurrency-sensitive writes accept an
`expectedVersion` and reject with a `conflict` instead of overwriting. Only
transient codes are retryable, and only for idempotent operations.

**Consequences.**

- The UI can branch on a code and show a safe reason plus the next step.
- A retried submit/import/reorder does not double-create.
- A stale write surfaces a re-read request rather than silently winning.

## ADR-0010 — Atomic local CSV import with diff preview

**Status:** Accepted for P0 hardening.

**Context.** The import path could parse and preview a CSV but applying it only
wrote a job log with no product/offer data, no existing-SKU dedup and no atomic
strategy.

**Decision.** `resolveImportRows` enriches parsed rows with an added/updated/
unchanged/error status and a before/after diff against existing offers.
`Repository.applyCatalogImport` writes products/offers atomically, upserts by
supplier SKU (no duplicates on re-import), and refuses the whole apply if any row
has an error. XLSX, ERP/1C and live sync remain out of scope.

**Consequences.**

- Re-importing the same file changes nothing and creates no duplicates.
- A single bad row cannot partially corrupt a valid apply.
- The file is treated as plain text; no formulas, macros or HTML are executed.

## ADR-0011 — Per-organization baskets

**Status:** Accepted (post-P0 hardening).

**Context.** The repository held a single `basket`, hard-bound to one org id. A
second buyer organization saw an empty basket and every basket write threw
`forbidden`, so a legitimate multi-tenant deployment could not function, and the
modeling risked conflating two tenants' lines.

**Decision.** `RepositoryState.basket` becomes `baskets: Basket[]`, scanned by
`orgId` (never by position). Basket reads/writes resolve the acting org's own
basket, creating an empty one lazily on first write. `submitBasket`,
`reorderIntoBasket`, lists and location selection remain scoped to the acting
org; a foreign location is still rejected.

**Consequences.**

- Two buyer orgs can each hold, edit and submit their own basket.
- No shared basket object can leak or block across tenants.
- A real backend must key baskets by `organization_id` with a unique constraint.

## ADR-0012 — Backend path: keep the boundary, defer the provider

**Status:** Open / proposed. Not implemented.

**Context.** The product needs real server-side authentication and authorization,
durable storage and row-level security before any public launch (see the launch
gates). No staging environment, provider account, credentials or legal operator
exist yet, and creating a paid resource needs separate permission.

**Decision (proposed, not executed).** Keep the current pure-domain + repository
boundary and treat the in-browser `Repository` as a stand-in for a server API.
When a backend is chosen, the lowest-risk path is a single relational database
(PostgreSQL, possibly via Supabase) with:

- one table per domain entity in `src/domain/entities.ts`;
- `organization_id` / `supplier_id` / `location_id` foreign keys on every
  tenant-owned row, with uniqueness on `(supplier_id, supplier_sku)` and on
  `(organization_id)` for the basket;
- RLS enabled (deny-by-default) on every exposed table, policies derived from a
  trusted membership table, never from client-supplied ids or `user_metadata`;
- the same optimistic `version` columns the repository already uses;
- the domain functions in `src/domain/**` reused server-side, not re-implemented.

This ADR stays **proposed** until a dedicated non-production environment and
explicit permission exist. No provider is selected; `@supabase/supabase-js` is
present but unused, and is not evidence of a backend.

**Consequences.**

- The client rules remain the only enforcement today and are explicitly not a
  security boundary once data leaves the browser.
- A future server must reproduce every check currently unit-tested in the
  repository, plus RLS tests per role/tenant.

## ADR-0013 — Deployment posture: static demo only, no paid resources

**Status:** Accepted.

**Context.** The build produces a static SPA in `dist/`. Hosting it as a public
demo is technically trivial, but the brief distinguishes a demo from a live
marketplace and forbids creating paid resources or publishing without explicit
owner approval.

**Decision.** The repository ships configuration and a runbook for a **static
demo** deployment only. No domain, paid plan, secret or production environment is
created by this work. A hardened deployable release candidate (commit + target +
operating mode) may be prepared for the owner; the owner must separately approve
the exact commit, domain and mode before any public production deploy.

## ADR-0014 — Branch-scoped cancellation and total parent aggregation

**Status:** Accepted (post-P0 hardening).

**Context.** The suborder state machine allowed a transition to `cancelled` from
most states, and `recomputeParentStatus` handled `cancelled` children, but the
repository had **no method that could ever cancel a branch** — the capability was
unreachable. Separately, the parent aggregation fell through to `awaiting_supplier`
for any mix of terminal states (e.g. one `rejected` + one `cancelled`), which
falsely implied a supplier was still expected to respond.

**Decision.**

- Add `Repository.cancelSuborder(ctx, suborderId, reasonDemo, expectedVersion?)`,
  authorised by a new `canCancelSuborder` policy: the **owning buyer org**
  (owner/admin/buyer) may cancel any of its branches; the branch's **own
  supplier** (owner/admin/order_operator) may cancel only its own branch. A
  foreign org/supplier, a viewer/receiver, or a platform operator may not.
- The operation is **branch-scoped** (siblings untouched), **state-machine
  checked**, **optimistic-concurrency checked**, and **idempotent** (cancelling an
  already-cancelled branch is a no-op with no second audit event).
- Make `recomputeParentStatus` total: a mix of terminal children never reads as
  `awaiting_supplier`; the fallback is reached only when a child is genuinely
  pending.

**Consequences / honesty.**

- There is **no reservation or inventory ledger** in this prototype, so
  cancellation cannot release a real reservation. The audit event records
  `reservationReleased: false` rather than pretending otherwise. A real backend
  must release the branch's own reservation in the same transaction.
- Cancelling one branch never cancels the parent procurement; the detail views
  always render every branch's own state.
