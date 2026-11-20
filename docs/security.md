# Security and data-handling notes (P0)

This prototype is local-only and uses synthetic data. The notes below describe
the threat model the design anticipates and how P0 answers it, so a future
backend can be held to the same standard.

## Threat model (multi-tenant marketplace)

| Threat                      | P0 posture                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant / org id spoofing    | Ids from the UI are data, not authorization. Policy checks compare the caller's membership against the entity's org at every read/write. |
| IDOR                        | Repository methods verify membership → entity ownership before acting.                                                                   |
| Cross-supplier leakage      | A supplier suborder is readable only by the owning buyer org or that exact supplier.                                                     |
| Privilege escalation        | Role checks are per action (`canManageProcurement`, `canEditSupplierCatalog`, ...).                                                      |
| Unsafe import / file upload | CSV is parsed locally, size/row limited, formula-prefixed cells neutralised, no macro/HTML execution, per-row errors.                    |
| XSS                         | React escapes by default; no `dangerouslySetInnerHTML`; CSV values are rendered as text.                                                 |
| CSRF / SQL injection        | No server, no SQL, no cookies in P0. Modelled for the future backend.                                                                    |
| Secret leakage              | No secrets in the repo; `.env*` ignored; service-role names blocked in gitignore; nothing is sent to the browser that shouldn't be.      |
| Replay / races              | Fulfillment events carry an idempotency key; suborders carry a `version` for optimistic concurrency.                                     |
| PII in logs / notifications | Audit metadata is a small non-PII bag; fixtures contain no real people, addresses or phones.                                             |

## P0 guarantees

- No real business or personal data is stored or transmitted.
- No network calls leave the page; no external services are contacted.
- The "session" is a demo persona switch, explicitly labelled as not real
  authentication.

## What a real product must add

- Server-side enforcement of every policy check (the client rules are not a
  security boundary once a backend exists).
- Row-level security with deny-by-default if Supabase/PostgreSQL is used, tested
  per role and per organisation.
- The `service_role` key confined to a trusted server boundary, never shipped to
  the browser.
- Parameterized queries, transactions and optimistic locking on shared writes.
- Rate limiting and abuse controls on any import/upload endpoint.
- A documented data-retention and deletion strategy.
- Reviewed audit logging that omits PII and secrets.

## Hardening pass (branch `harden/p0-product-ready`)

The following P0 hardening changes were made within the local, synthetic-data
scope only. No backend, no database, no network calls.

| Area            | Change                                                                                                                                                                                                     |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IDOR/BOLA       | Procurement detail, decisions, receipts and parent reads are tenant-scoped through `Repository.visibleSubordersOf` / `getVisibleParent`. Foreign or guessed ids return a safe not-found/forbidden.         |
| Location scope  | The basket has an explicit deliver-to location selected from the acting org's locations (`setBasketLocation`, `canAccessLocation`). Lists are scoped by the acting membership's org, never `locations[0]`. |
| Zone coverage   | Each supplier group carries a `zoneCoverage` state; unknown/not-covered holds the group back with an exact reason instead of "delivery available".                                                         |
| Freshness       | A stale or changed price is a submit blocker requiring explicit re-confirmation (`cart.ts` produces `price_stale`).                                                                                        |
| Concurrency     | `buyerDecide`, `proposeChange`, `confirmSuborderNoChange`, `updateOfferPrice`, `updateOfferAvailability` take an `expectedVersion` and reject on mismatch.                                                 |
| Idempotency     | `submitBasket`, `applyCatalogImport`, `reorderIntoBasket` accept an idempotency key and replay instead of double-creating.                                                                                 |
| Parent entity   | A persisted `ParentProcurement` owns its suborders; partial states aggregate without hiding any branch.                                                                                                    |
| CSV import      | `applyCatalogImport` writes products/offers atomically, dedupes by SKU, and refuses the whole apply if any row errors; re-import writes nothing when unchanged.                                            |
| Error catalogue | `src/domain/errors.ts` provides stable codes and safe messages; the UI renders only `message`/`nextStep`.                                                                                                  |

All of the above are covered by unit/repository tests (`npm run test`) and by
Playwright scenarios (`npm run e2e`). They run locally on synthetic data and do
not prove that any real service, payment, or delivery works.

## Expanded threat model (post-P0 hardening)

Each row names the prevention, the test that covers it locally, and the residual
risk once a real backend exists.

| Threat                        | Prevention (local)                                                                                                             | Covered by                                                                            | Residual risk                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Cross-tenant read (IDOR/BOLA) | Every read is scoped to the acting org/supplier; foreign or guessed ids return undefined/forbidden                             | `authorization.test.ts`, `repository.test.ts` (procurement detail, suborders, parent) | Must be re-enforced server-side with RLS + object checks                  |
| Cross-tenant basket write     | Baskets are per-org (`baskets[]` by `orgId`); a second org gets its own basket, never the first org's                          | `repository.test.ts` "per-org baskets"                                                | Needs a unique `organization_id` constraint server-side                   |
| Privilege escalation          | Per-action role checks (`canManageBasket/Procurement`, `canEditSupplierCatalog`, `canRespondToSuborder`, `canRecordReceiving`) | `authorization.test.ts` role matrix                                                   | Server must derive the role from a trusted membership row, not the client |
| Viewer/receiver write         | Viewers and receivers cannot edit basket/lists/terms; receivers can only record receiving                                      | `repository.test.ts`                                                                  | same                                                                      |
| Stale-data application        | Stale/changed price is a submit blocker; buyer re-confirms the exact revision; unknown ≠ 0                                     | `cart.test.ts`, `freshness.test.ts`                                                   | Requires the server's live re-check at checkout                           |
| Lost update / race            | Optimistic `expectedVersion` on buyer/suborder/offer/receipt/fulfillment writes                                                | `repository.test.ts` concurrency cases                                                | Needs DB-level conditional updates / row locks                            |
| Cross-branch cancellation     | `cancelSuborder` is branch-scoped and role-checked; a foreign org/supplier, viewer or receiver is refused; idempotent          | `authorization.test.ts`, `repository.test.ts` "cancel a single suborder branch"       | Server must release only the branch's own reservation atomically          |
| Double submit / replay        | Idempotency keys on submit/import/reorder; fulfillment events keyed per transition                                             | `repository.test.ts`                                                                  | Needs a unique idempotency constraint server-side                         |
| Unsafe CSV / file import      | Bounded size/rows, plain-text parse, formula/HTML neutralisation, no macro execution, atomic apply, SKU dedup                  | `catalogImport.test.ts`                                                               | Server must bound upload size/rate and never eval cells                   |
| XSS                           | React escaping; no `dangerouslySetInnerHTML`; CSV rendered as text                                                             | code review                                                                           | CSP headers and output-encoding on the server                             |
| CSRF / SQL injection / SSRF   | No server, no SQL, no cookies, no outbound fetch today                                                                         | n/a (modelled)                                                                        | Must be handled when a backend/import fetch exists                        |
| Secret leakage                | No secrets in repo; `.env*` ignored; nothing sent to the browser that shouldn't be                                             | `.gitignore`, review                                                                  | Secret manager + rotation on the server                                   |
| PII in logs/audit             | Audit metadata is a small non-PII bag; fixtures are fictional                                                                  | `errors.test.ts`, fixtures                                                            | Structured logging with redaction server-side                             |
| Rate abuse / brute force      | Not applicable (no endpoints); import size-bounded                                                                             | n/a                                                                                   | Rate limits on registration/search/import when live                       |

## Reliability

- Retries are only for transient, idempotent operations; business errors are not
  retried. Side effects carry an idempotency key. A conflict asks the caller to
  re-read rather than overwrite. There is no automatic network retry because
  there is no network.
- Observability is **local only**: there is no connected monitoring, alerting or
  tracing system, and none is claimed. A real deployment must add health checks,
  error/latency/conflict metrics and correlation ids.
