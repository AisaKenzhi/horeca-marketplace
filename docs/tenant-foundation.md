# Authenticated tenant and catalog foundation

This slice adds an opt-in Supabase-backed account workspace alongside the existing synthetic demo. It is active only when `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or legacy `VITE_SUPABASE_ANON_KEY`) are configured. The demo-persona switch remains a demo convenience and is not used as an authentication or authorization source.

## What persists

- **Organizations** are buyer or supplier tenants. A signed-in user creates one; a database trigger adds that same `auth.uid()` as its initial `owner` in the same transaction. The client cannot insert, edit, or delete membership rows directly.
- **Memberships** store trusted organization roles. In this first slice, each organization has only its creator/owner. Invitations, role changes, removing members, and shared multi-user administration are not implemented.
- **Buyer locations** are owned by one buyer organization. Their addresses can be read only by authorized members of that tenant; supplier users cannot query them through this API. No address format, country, geofence, or delivery zone is assumed.
- **Supplier profiles** start in `pending`. The client cannot set or update the verification status. There is no operator review queue in this slice, so a pending profile must never be described as verified.
- **Catalog offers** belong to exactly one supplier organization and contain a supplier SKU, sell-unit/pack details, MOQ, order step, currency, price and separately timestamped availability. Currency is entered explicitly; no country or currency default is selected. Price is a decimal amount paired with a three-letter currency code; no conversion or settlement is performed. Draft offers are supplier-private. Only published offers from approved suppliers are visible to signed-in accounts; anonymous visitors see none.

The shared authenticated catalog follows the existing domain model's cross-supplier catalog. Pending suppliers can save drafts but cannot publish. A narrow internal helper reads only the approval status to enforce this gate without recursively applying profile RLS. This does not create an anonymous public storefront, certify a supplier beyond the explicit review status, validate a price, accept an order, or promise stock/delivery.

## Security boundary

Every table in `public` has RLS enabled. The migration revokes client table grants and grants back only the exact operations/columns required by onboarding and catalog discovery. `anon` gets no table grants. Membership roles are read from protected database rows; editable Auth user metadata and client-supplied role claims are not used for authorization. `private.has_org_role` is `SECURITY INVOKER` and executable by authenticated users for RLS checks. `private.add_organization_owner` is a trigger-only `SECURITY DEFINER` routine with no client execute grant. `private.is_approved_supplier` is a narrowly scoped `SECURITY DEFINER` predicate that requires `auth.uid()` and reveals only an approval boolean; only authenticated users can execute it. All three helpers are outside the Data API because the `private` schema is not in the API allow-list.

The local `supabase/config.toml` exposes only `public` and sets `api.auto_expose_new_tables = false`. Explicit grants are part of the migration because table grants and RLS are distinct controls. In a hosted project, confirm that the intended Data API schema is enabled and retain the explicit migration grants; do not make `private` exposed. No service-role or secret key belongs in Vite environment variables.

## Run locally

The repository now contains a local Supabase project configuration, an imperative migration, and pgTAP policy tests. With Docker and the Supabase CLI installed, use only the local commands:

```bash
npx supabase start
npx supabase db reset
npx supabase test db
npx supabase status
```

Copy the local API URL and public anon/publishable key from `supabase status` into an ignored `.env.local` file as `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or use `VITE_SUPABASE_ANON_KEY` for compatibility), then restart Vite. Never use `supabase link`, `supabase db push`, a hosted database URL, a service-role key, or a production project as part of this local test flow. A hosted deployment and hosted migration have not been configured or run.

The SQL policy suite is `supabase/tests/tenant_catalog_rls.test.sql` (25 pgTAP assertions). It exercises organization and location isolation, the owner bootstrap trigger, function/table grants, anonymous denial, approved-only published catalog visibility, pending supplier protections, and catalog-vs-order-operator permissions with synthetic identities. It must be run on the local Supabase stack before treating the database layer as verified.

## Deliberately not included

This foundation does not implement invitations, account recovery screens, profile identity verification, operator approval, account deletion/retention, orders, procurement history, CSV uploads to a server, notifications, payments, escrow, split settlement, delivery-provider integrations, or market-specific/legal validation. The buyer/supplier screens are an onboarding and catalog slice, not a claim that Product Ready has been reached.

## Technical references

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security): grants decide whether a role can reach a table; RLS policies separately decide which rows it may access. The guide recommends enabling RLS for exposed tables, explicit least-privilege grants and database policy tests.
- [Securing the Supabase Data API](https://supabase.com/docs/guides/api/securing-your-api): use explicit grants together with RLS; revoke unneeded client privileges and keep internal schemas outside the API surface.
- [Supabase CLI configuration](https://supabase.com/docs/guides/local-development/cli/config): `api.schemas` controls local API schema exposure, and `api.auto_expose_new_tables` can require explicit table grants.
- [Supabase changelog: tables are no longer automatically exposed](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically): the platform's automatic table exposure behavior changed, with enforcement on existing projects from 2026-10-30. This implementation does not rely on automatic grants.
