# Product scope, roles and data model

This document connects the product brief to the prototype and authenticated workspace. The current pilot model is **platform-as-seller**; this does not settle which legal entity operates the platform.

## What the current slice does

The private synthetic-data demo remains available. The optional authenticated Supabase workspace adds tenant-scoped buyers and suppliers, catalog offers, saved procurement lists, draft carts and a persisted buyer-facing procurement request. A buyer manager must explicitly submit a cart. The server rechecks offer version, price and availability freshness, price expiry, supplier approval, MOQ and order step before atomically saving the request and its internal supplier fulfillment suborders.

The buyer-facing parent records the platform as seller and has the status `submitted`. It is a request only, not an accepted order, invoice or payment. Its immutable line snapshots preserve the terms observed at submission. Private suborders link the request lines to the supplier offer and supplier tenant, but suppliers cannot view them in this slice. The operation is idempotent, and the submitted draft cart is frozen in the same transaction.

Supplier availability is a supplier-reported status, with no numeric stock quantity. It is neither a reservation nor a guarantee that goods will be available for purchase. A successful catalog check also does not confirm delivery coverage, a price settlement, or supplier acceptance.

## Product principles

1. Packaging, sell unit, price, unit price, MOQ, order step and delivery information are distinct; a readiness review does not confirm delivery.
2. Price and availability have separate observation timestamps. Stale or unknown terms block a request; the server repeats the checks on submission.
3. A combined buyer cart is grouped into private supplier fulfillment suborders while the buyer-facing request remains a platform-seller parent.
4. Drafting, explicit request submission, seller acceptance, fulfillment, receipt and payment are separate states. Only the draft and request-submission slice is persisted here.
5. Supplier changes are not silent; the existing demo requires an explicit buyer decision per revision.
6. Reorder creates a new draft and rechecks terms.
7. The demo is private and collects no money.

## Not implemented in this slice

- No supplier notification, external purchase/order placement, supplier acceptance or stock reservation.
- No checkout, card handling, payment, escrow, split settlement, invoice, tax calculation or financial data.
- No delivery booking, logistics, routing, GPS or cold-chain features.
- No public catalog, public storefront or production deployment.
- No email/SMS/push/WhatsApp/Telegram messaging.
- No real supplier or buyer onboarding, certification or quality guarantee.
- No XLSX/ERP/1C import; CSV import is local to the demo.

## Roles

| Side     | Role                | Current capability                                                         |
| -------- | ------------------- | -------------------------------------------------------------------------- |
| Buyer    | owner / admin       | Manage tenant procurement and members; submit a request                    |
| Buyer    | buyer               | Manage procurement; explicitly submit a request                            |
| Buyer    | receiver            | Record receiving in the demo; cannot change terms                          |
| Buyer    | viewer              | Read-only tenant access                                                    |
| Supplier | owner / admin       | Manage the supplier tenant and catalog; internal suborders are not visible |
| Supplier | catalog_operator    | Edit the supplier catalog only                                             |
| Supplier | order_operator      | No persisted suborder response in this slice                               |
| Platform | moderator / support | Read-only demo moderation queue and audit                                  |

Authenticated database policies and RPCs enforce tenant and role boundaries. UI checks are not the security boundary.

## Data model

The prototype domain includes organizations, memberships, buyer locations, supplier profiles, products, supplier offers, buyer lists and carts, parent procurement requests, supplier suborders, revisions, buyer decisions, fulfillment events, receipt records, issues, catalog import jobs, notification events and audit events.

In the Supabase workspace, `buyer_procurement_requests` and their immutable lines are buyer-facing and RLS-filtered by buyer tenant. Internal supplier suborders and their lines are in the non-exposed `private` schema, have no client grants, and are created only by the atomic request RPC.

## Decisions still open

The selected platform-as-seller model is for the pilot data and request flow; these decisions remain open and are not silently assumed:

- Legal operator/company entity and whether one is required.
- Applicable tax rules, invoicing and seller-of-record legal details.
- Payment collection, settlement, commission and monetisation.
- Delivery workflow, coverage, tariffs and responsibility.
- First city and target segment; priority product categories.
- Real suppliers, real tariffs, launch timeline, and data-retention/deletion policy.

## Reversible demo assumptions

- Russian is the default UI language.
- Catalog freshness threshold is 24 hours.
- KZT is used only for synthetic examples; supplier offers must state their currency explicitly.
- Persona switching is a demo convenience, not authentication.
