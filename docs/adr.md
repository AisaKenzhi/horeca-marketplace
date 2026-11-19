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
