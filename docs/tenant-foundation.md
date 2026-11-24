# Authenticated tenant, catalog and procurement-request foundation

This slice adds an opt-in Supabase-backed workspace alongside the existing synthetic demo. It is active only when `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or the legacy `VITE_SUPABASE_ANON_KEY`) are configured. Demo-persona switching is not an authentication or authorization source.

## What persists

- **Organizations and memberships** are buyer or supplier tenants. A signed-in user creates an organization; a database trigger adds that same `auth.uid()` as its initial owner in the same transaction. Membership rows are managed only through narrowly scoped RPCs. Trusted membership rows, not editable Auth user metadata or client claims, determine authorization.
- **Buyer locations** belong to one buyer organization. Addresses are readable only by authorized members of that tenant. No country, address format, geofence or delivery zone is assumed.
- **Supplier profiles** start as `pending`; the client cannot set or change verification status. No operator review queue exists in this slice, so a pending profile must not be described as verified.
- **Catalog offers** belong to one supplier organization and store supplier SKU, sell unit and pack details, MOQ, order step, explicit currency, price, and separately timestamped availability. Pending suppliers may save drafts but cannot publish. Signed-in accounts see only published offers from approved suppliers; anonymous visitors see none. Prices are not converted or settled.
- **Buyer lists and draft carts** are tenant-scoped and persist across reloads. Copying a saved list to a new draft is atomic. Cart lines capture offer version at copy time, so changed terms can be flagged for review. Drafts are editable planning records, not orders.
- **Procurement requests** are created only when an owner, admin or buyer explicitly confirms a ready draft. The server locks the cart, rechecks the current offer version, supplier approval, price and availability observation timestamps, price expiry, `in_stock` status, MOQ and order step, then atomically creates a buyer-facing parent request and private supplier fulfillment suborders. The parent names the **platform as seller** for the pilot and is recorded only as `submitted`, not accepted. Its immutable lines preserve the checked product, packaging, price, currency, availability, observation times and offer version. Internal suborder lines link to the matching catalog offer and supplier tenant. The operation is idempotent; retrying with the same key returns the existing request, and the source cart is frozen in the same transaction. Any failure rolls back the parent, snapshots, suborders and cart freeze together.

Availability is supplier-reported and has no numeric stock quantity. It is not reserved and is not a guarantee that goods will be available for purchase. The request does not place an external supplier order, notify suppliers, record supplier acceptance, charge money, issue an invoice, calculate tax or arrange delivery.

## Security boundary

Every table in `public` has RLS enabled. Grants and RLS are separate controls: migrations revoke broad client privileges and grant only the required operations and columns. Buyer request headers and snapshot lines are readable only by members of their buyer tenant; client writes to these immutable records are revoked. Update/delete triggers also reject privileged mutation so request snapshots and private routing rows cannot be silently changed. The supplier suborder tables live in the non-exposed `private` schema and have no client grants or supplier-facing policies, so neither another buyer nor a supplier can inspect the internal routing records.

The public request RPC is a `SECURITY INVOKER` wrapper. It calls a non-exposed `SECURITY DEFINER` worker with an empty pinned `search_path`; the worker checks the authenticated user, buyer organization and manager role before operating. The worker serializes cart edits and submission by locking the parent cart first, locks its lines and offer/profile rows in stable order, and performs all writes within one database transaction. Cart line quantity edits and removals now use parent-locking RPCs; direct line writes are revoked to avoid a race with submission. Internal functions have explicit execute grants, and `private` remains outside the Data API schema allow-list.

The local `supabase/config.toml` exposes only `public` and sets `api.auto_expose_new_tables = false`. Hosted exposure and grants must not be broadened as a workaround. No service-role or secret key belongs in Vite environment variables.

## Run local checks

The repository uses imperative migrations. With Docker and the Supabase CLI available, use only the local project commands:

```bash
npx supabase start
npx supabase db reset
npx supabase test db
npx supabase status
```

`supabase/seed.sql` is intentionally empty. pgTAP fixtures use synthetic identities and records inside transactions and roll them back. Never link the local project to a hosted database or run these tests against production data.

The SQL suites cover tenant/catalog RLS, invitations, procurement lists, persisted draft carts, supplier catalog imports and the platform-seller request flow. The request suite exercises success and snapshots, replay and conflicting idempotency keys, stale-price/version and other blockers, immutable triggers, transaction rollback after a simulated supplier-routing failure, cart freezing, buyer-role authorization, and cross-tenant/supplier/anonymous denial. `.github/workflows/supabase-db.yml` applies migrations and runs the database suites against a fresh local PostgreSQL service on feature-branch pushes and pull requests; it uses no hosted project or secrets. Local Supabase database tests require Docker, so a successful application test run alone does not verify SQL. Check the feature branch's database CI before claiming that the database suites passed.

## Boundaries and remaining decisions

Invitations are passed manually; the app does not send email. A buyer request is persistable, but no external order, supplier notification or acceptance, stock reservation, invoice, tax calculation, payment, settlement or delivery operation is implemented. The pilot model selects the platform as seller, but the platform's legal operator/company entity, tax rules, payment and settlement model, and delivery workflow remain unconfigured and open. No jurisdiction, tax rate, currency conversion, delivery coverage, operator identity or legal status is assumed. Account recovery screens, identity verification, account deletion/retention, broader compliance validation and production deployment are also outside this slice.

## Technical references

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security): grants decide whether a role can reach a table; RLS policies separately decide which rows it may access.
- [Securing the Supabase Data API](https://supabase.com/docs/guides/api/securing-your-api): use explicit grants together with RLS and keep internal schemas outside the API surface.
- [Supabase Database Functions](https://supabase.com/docs/guides/database/functions): prefer `SECURITY INVOKER`; for `SECURITY DEFINER`, pin an empty `search_path`, qualify object names, and explicitly control execution grants.
- [Supabase CLI configuration](https://supabase.com/docs/guides/local-development/cli/config): `api.schemas` controls local API exposure; `api.auto_expose_new_tables` can require deliberate grants.
- [Supabase changelog: tables are no longer automatically exposed](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically): this implementation does not rely on automatic grants.
