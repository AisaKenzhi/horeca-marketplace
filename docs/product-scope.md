# Product scope, roles and data model (P0)

This document links the product brief to what the prototype actually does. It is
deliberately short and avoids copying the full source specification.

## What P0 is

A private, local prototype on synthetic data that demonstrates the buyer →
supplier → decision scenario for a B2B HoReCa procurement marketplace. It is not
a running marketplace and makes no commercial claim.

## P0 goals (and how they are shown)

1. **Every offer and suborder names its seller.** Offer cards show the supplier;
   basket groups and suborders are per supplier.
2. **Sell unit, pack size, price, unit price, MOQ, step and delivery are not
   mixed.** See `src/domain/packaging.ts` and the catalog card.
3. **Price and availability carry timestamps; stale/unknown is flagged.** See
   `src/domain/freshness.ts` and the freshness badges.
4. **The basket merges for convenience but splits into independent supplier
   suborders.** See `src/domain/cart.ts` and the basket screen.
5. **Confirmation, fulfillment, receipt and payment are separate.**
   `src/domain/orderLifecycle.ts` models three independent state machines.
6. **Supplier changes are never silent.** `src/domain/revisions.ts` requires an
   explicit buyer decision per revision.
7. **Reorder builds a new draft and re-checks price/availability.**
   `src/domain/reorder.ts`.
8. **The demo UI collects no money and is not a public storefront.**

## Non-goals (explicitly out of P0)

- No payments, checkout, cards, escrow, split payment or financial data.
- No email/SMS/push/WhatsApp/Telegram or any real messaging.
- No public catalog, public storefront or production deployment.
- No logistics, routing, GPS or cold-chain features.
- No real supplier/buyer onboarding; personas are demo switches.
- No XLSX/ERP/1C import; CSV only, local, validated.
- No certification, quality guarantee or compliance claim.

## Roles

| Side     | Role                | Can do                                                         |
| -------- | ------------------- | -------------------------------------------------------------- |
| Buyer    | owner / admin       | Manage procurement, confirm/reject revisions, record receiving |
| Buyer    | buyer               | Manage procurement, confirm/reject revisions                   |
| Buyer    | receiver            | Record receiving; cannot change terms                          |
| Buyer    | viewer              | Read-only                                                      |
| Supplier | owner / admin       | Edit catalog, respond to suborders                             |
| Supplier | catalog_operator    | Edit catalog only                                              |
| Supplier | order_operator      | Respond to suborders only                                      |
| Platform | moderator / support | Read-only demo moderation queue and audit                      |

Authorization is enforced in `src/domain/authorization.ts` and exercised by the
repository methods. In P0 the repository is in-browser; a future backend must
repeat these checks server-side.

## Data model (prototype shape)

- `organization`, `membership`, `buyer_location`
- `supplier_profile`
- `product`, `supplier_offer` (per-SKU, per-supplier, versioned)
- `buyer_list`, `basket`, `basket_line`
- `parent_procurement`, `supplier_suborder`
- `suborder_revision`, `buyer_decision`
- `fulfillment_event`, `receipt_record`, `issue`
- `catalog_import_job`, `notification_event`, `audit_event`

Types live in `src/domain/entities.ts`.

## Open decisions owned by the project owner (not product defaults)

These are consciously left undecided and are NOT baked in as defaults:

- First city and target segment.
- Priority product categories.
- Legal operator / company entity and whether one is required.
- Who owns the sale (platform vs supplier).
- Monetisation, commission rates, launch timeline.
- Real suppliers, real tariffs, and how money is collected.
- Data-retention and deletion policy.

## Assumptions made for the demo (reversible)

- Russian is the default UI language.
- Staleness threshold is 24 hours, configurable via `VITE_STALENESS_HOURS`.
- KZT is used only for synthetic examples.
- All persona switching is a demo convenience, not authentication.
