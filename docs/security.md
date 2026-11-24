# Security and data-handling notes (P0)

This prototype has two separate surfaces: a synthetic, browser-only demo and an
opt-in `/account` workspace backed by Supabase. Unless explicitly marked
otherwise, “P0” and “demo” below refer to the synthetic path. The account slice
sends Auth and data requests only to its configured Supabase project and persists
user, organization, location and catalog records under database grants and RLS;
it is not a full marketplace backend.

## Threat model (multi-tenant marketplace)

| Threat                      | P0 posture                                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Tenant / org id spoofing    | Ids from the UI are data, not authorization. Policy checks compare the caller's membership against the entity's org at every read/write.         |
| IDOR                        | Repository methods verify membership → entity ownership before acting.                                                                           |
| Cross-supplier leakage      | A supplier suborder is readable only by the owning buyer org or that exact supplier.                                                             |
| Privilege escalation        | Role checks are per action (`canManageProcurement`, `canEditSupplierCatalog`, ...).                                                              |
| Unsafe import / file upload | CSV is parsed locally, size/row limited, formula-prefixed cells neutralised, no macro/HTML execution, per-row errors.                            |
| XSS                         | React escapes by default; no `dangerouslySetInnerHTML`; CSV values are rendered as text.                                                         |
| CSRF / SQL injection        | Demo has no custom server endpoint. The account route uses `supabase-js` Data API calls, not raw SQL; access relies on explicit grants and RLS.  |
| Secret leakage              | No service-role/secret key in browser config; the client may hold only the Supabase URL and publishable/legacy anon key.                         |
| Replay / races              | Fulfillment events carry an idempotency key; suborders carry a `version` for optimistic concurrency.                                             |
| PII in logs / notifications | Demo audit metadata is non-PII and fixtures are fictional; the account stores email and workspace data in Supabase, with no logging integration. |

## Synthetic demo guarantees (not the account route)

- The demo uses fictional data in browser memory. The optional account route may
  store the user's email plus organization, location and catalog data in Supabase.
- The demo path makes no backend calls. When configured, `/account` sends Auth and
  data requests to the specified Supabase project; no other third-party service is
  integrated.
- The persona switch is a demo convenience, not authentication. `/account` uses
  Supabase Auth and database RLS.

## Remaining work before any hosted product launch

- Configure hosted Auth URLs, email delivery and project rate limits; locally
  verify the migration, RLS suite and Supabase advisors before applying anything
  to a hosted database.
- Add invitations, account recovery, role administration, supplier-review
  operations, and an account deletion/retention process.
- Keep future orders, payments, notifications and other high-risk business writes
  behind reviewed database transactions or trusted server functions; never trust
  demo/client checks as an authorization boundary.
- Add abuse controls for registration and future import/upload endpoints, plus
  reviewed audit logging that omits PII and secrets.
- Payments, market-specific legal rules and delivery integrations remain out of
  scope until the owner selects a business model and market.

## Hardening pass (branch `harden/p0-product-ready`)

This section describes changes to the original local, synthetic-data demo path
only. The optional Supabase-backed account path is separate and documented below.

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

## Expanded synthetic-demo threat model (post-P0 hardening)

Each row names the local synthetic-demo prevention and test, plus remaining risks
for a future ordering backend; account-specific facts are marked in the relevant rows.

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
| CSRF / SQL injection / SSRF   | Demo has no custom endpoint; account calls Supabase Auth/Data API and sends no raw SQL; RLS and grants bound database access   | local pgTAP suite (local CI only)                                                     | Verify hosted RLS; no custom SSRF-capable server route is added           |
| Secret leakage                | Frontend accepts only a Supabase URL and public publishable/legacy anon key; no service-role key is used                       | `.gitignore`, code review                                                             | Keep server secrets outside the browser and rotate them                   |
| PII in logs/audit             | Demo fixtures are fictional; account stores email and tenant/location data but adds no logging integration                     | `errors.test.ts`, fixtures; tenant pgTAP suite (local only)                           | Set retention rules and redact future server-side logs                    |
| Rate abuse / brute force      | Account signup uses Supabase Auth; local limits are configured, but hosted limits and abuse resistance are not verified        | local Supabase config + local CI (hosted limits unverified)                           | Configure hosted limits and test registration/search/import abuse         |

## Reliability

- The synthetic demo has no external calls. The account data layer does not
  automatically retry network operations; errors surface in the UI, and future
  business mutations still need explicit idempotency and transaction design.
- Observability is **local only**: there is no connected monitoring, alerting or
  tracing system for either path, and none is claimed. A real deployment must add
  health checks, error/latency/conflict metrics and correlation ids.

## Authenticated tenant foundation

The Product Ready feature branch adds a separate Supabase-backed account slice;
the demo persona flow remains local and synthetic. `supabase/migrations/` defines
organizations, owner memberships, buyer locations, supplier profiles and supplier
catalog offers. RLS is enabled on every exposed application table, `anon` receives
no grants, and authenticated table/column grants are paired with tenant and role
policies. The creator-to-owner trigger checks `auth.uid()` and is not exposed as
an RPC; client roles cannot write membership records. Supplier listings remain
explicitly published and visible only to authenticated users, while a supplier's
review status is never self-assignable.

These controls are implemented in a migration and a local pgTAP suite, but have
not been applied to or tested against a hosted database. Local RLS execution
requires the Supabase CLI and Docker. The exact scope, setup and remaining limits
are in `docs/tenant-foundation.md`.
