# P0 hardening plan and acceptance criteria

Baseline at start: `main` @ `45c0eea`, clean tree. `npm run verify` green
(lint 0 errors, typecheck clean, 105 unit/component tests, build ok). E2E: 20
runs (10 scenarios × desktop + mobile).

Work happens on branch `harden/p0-product-ready`. Nothing is pushed, merged or
deployed without a separate instruction.

The goal is a more _verifiable_ P0 within the three-level model in the brief:
local implementation + synthetic-data tests only. No staging, no production, no
external calls.

## Confirmed defects (verified against HEAD, not carried over blind)

1. **IDOR/BOLA in procurement detail.** `BuyerProcurementDetail` selects
   suborders by `procurementId` only, with no org/location/role check, and a
   supplier persona can open `/procurement/:id`. Basket line, receipt, and
   decision reads/writes are not consistently tenant-checked.
2. **Buyer lists use `buyerLocations[0]` as the org source.** The brief forbids
   inferring the current organisation from "the first location".
3. **No explicit location selection and no delivery-zone validation.** The
   basket carries a fixed location; a supplier whose `deliveryZones` excludes
   that location is never blocked.
4. **Reorder does not persist.** The UI computes a draft and shows a message but
   never writes a new draft basket, and does not re-flag stale/unknown price.
5. **CSV import is preview-only.** Applying writes a job log with an empty
   `appliedOfferIds`; no product/offer data is written, no existing-SKU dedup, no
   atomic apply strategy, no reversible result.
6. **No persisted parent procurement entity.** Suborders reference a
   `procurementId` but no `ParentProcurement` record exists.
7. **No idempotency.** Double-submit can create duplicate procurements; import
   can be applied twice.
8. **Stale price is never a submit blocker.** `computeLine` declares a
   `price_stale` problem but never produces it; a stale price can be submitted
   silently.

## Acceptance criteria (each closed by a test)

- **AC1 Tenant isolation.** No buyer org, supplier, or platform persona can read
  or write a suborder, revision, decision, receipt, or parent procurement outside
  its own scope, including via a direct URL or a forged id. Unknown ids return a
  safe not-found/forbidden.
- **AC2 Location scope.** Lists and basket are scoped by the acting membership's
  org; a location attached to a list is explicit and access-checked. No
  `locations[0]` inference.
- **AC3 Role matrix.** `viewer` cannot add/change/remove basket or list; `receiver`
  can record receiving but not terms; `catalog_operator` cannot respond to
  orders; `order_operator` cannot edit catalog; operator cannot edit terms.
- **AC4 Freshness + atomic confirm.** Stale/unknown price and availability are
  shown per line; submission requires an explicit buyer re-confirmation of the
  exact live price/quantity when the snapshot changed or the price is stale; the
  confirmed snapshot is immutable and recorded with author/version/time; a
  version check rejects a conflicting concurrent write instead of overwriting.
- **AC5 Reorder.** Reorder persists a new editable draft basket in the correct
  scope, carries intent/SKU (not old price/availability), re-checks live terms,
  moves missing/archived/unknown into an explicit decision list, never
  auto-submits, and is idempotent per click.
- **AC6 CSV import.** Full local path: parse → column map → strict validation →
  duplicate detection (in-file and existing) → preview added/updated/unchanged/
  error with row+field and before/after → explicit apply → write products/offers
  to the repository + job log → re-import creates no duplicates → invalid rows
  never partially corrupt an atomic apply → reversible.
- **AC7 Location selection + zone coverage.** Buyer selects one of their org's
  locations before submitting; the location is shown on the draft and each
  suborder; each supplier's coverage of that location is validated; unknown
  coverage blocks or is an explicit pending state, never "delivery available".
- **AC8 Parent + independent suborders.** A persisted `ParentProcurement` owns
  several independent single-supplier suborders; partial confirm/reject/fulfil
  states aggregate without hiding any branch; one branch's change never affects
  another; parent+selected suborders are created atomically; unready groups stay
  in the basket with an exact reason; re-submit / double-click / partial failure
  do not orphan a parent or duplicate suborders.
- **AC9 Error catalogue + idempotency.** Typed error codes; side-effect
  operations carry an idempotency key; retry is only for transient/idempotent
  operations; conflict surfaces a re-read, not a silent overwrite.

## Out of scope for this pass

- Any backend, Supabase, or SQL migration (the brief allows local schema only if
  a product need justifies it; the P0 has no server, so none is added).
- XLSX/ERP/1C import, live sync, geocoding.
- Real payment adapter wiring (only the contract + mock remain, unchanged).
