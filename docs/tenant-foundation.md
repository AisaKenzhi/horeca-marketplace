# Authenticated tenant and catalog foundation

This slice adds an opt-in Supabase-backed account workspace alongside the existing synthetic demo. It is active only when `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or legacy `VITE_SUPABASE_ANON_KEY`) are configured. The demo-persona switch remains a demo convenience and is not used as an authentication or authorization source.

## What persists

- **Organizations** are buyer or supplier tenants. A signed-in user creates one; a database trigger adds that same `auth.uid()` as its initial `owner` in the same transaction. The client cannot insert, edit, or delete membership rows directly.
- **Memberships** store trusted organization roles. Owners/admins can list members and pending invitations and can change roles, remove members, create/revoke invitations through narrowly scoped RPCs. The database remains authoritative for authorization.
- **Buyer locations** are owned by one buyer organization. Their addresses can be read only by authorized members of that tenant; supplier users cannot query them through this API. No address format, country, geofence, or delivery zone is assumed.
- **Supplier profiles** start in `pending`. The client cannot set or update the verification status. There is no operator review queue in this slice, so a pending profile must never be described as verified.
- **Catalog offers** belong to exactly one supplier organization and contain a supplier SKU, sell-unit/pack details, MOQ, order step, currency, price and separately timestamped availability. Currency is entered explicitly; no country or currency default is selected. Price is a decimal amount paired with a three-letter currency code; no conversion or settlement is performed. Draft offers are supplier-private. Only published offers from approved suppliers are visible to signed-in accounts; anonymous visitors see none.

The shared authenticated catalog follows the existing domain model's cross-supplier catalog. Pending suppliers can save drafts but cannot publish. A narrow internal helper reads only the approval status to enforce this gate without recursively applying profile RLS. This does not create an anonymous public storefront, certify a supplier beyond the explicit review status, validate a price, accept an order, or promise stock/delivery.

Catalog operators, organization owners and admins can update the price, explicit currency, and availability of their own offers after the supplier profile is approved. The account data layer checks the caller's trusted membership, supplier organization type, and approval status before sending an edit; RLS remains authoritative. Draft insertion remains available before approval, but pending suppliers cannot publish or update commercial terms. Offer title, packaging, SKU, tenant assignment, publication state through this terms editor, version, timestamps, and other unrelated columns remain outside its update grant. No currency or market default is selected.

## Security boundary

Every table in `public` has RLS enabled. The migration revokes client table grants and grants back only the exact operations/columns required by onboarding and catalog discovery. `anon` gets no table grants. Membership roles are read from protected database rows; editable Auth user metadata and client-supplied role claims are not used for authorization. `private.has_org_role` is `SECURITY INVOKER` and executable by authenticated users for RLS checks. `private.add_organization_owner` is a trigger-only `SECURITY DEFINER` routine with no client execute grant. `private.is_approved_supplier` is a narrowly scoped `SECURITY DEFINER` predicate that requires `auth.uid()` and reveals only an approval boolean; only authenticated users can execute it. All three helpers are outside the Data API because the `private` schema is not in the API allow-list.

The local `supabase/config.toml` exposes only `public` and sets `api.auto_expose_new_tables = false`. Explicit grants are part of the migration because table grants and RLS are distinct controls. In a hosted project, confirm that the intended Data API schema is enabled and retain the explicit migration grants; do not make `private` exposed. No service-role or secret key belongs in Vite environment variables.

## Run locally

The repository now contains a local Supabase project configuration, imperative migrations (including `20261123233842_organization_membership_invitation_lifecycle.sql`), and pgTAP policy tests. With Docker and the Supabase CLI installed, use only the local commands:

```bash
npx supabase start
npx supabase db reset
npx supabase test db
npx supabase status
```

`supabase/seed.sql` is intentionally empty: repeatable test identities and rows are created inside the pgTAP transaction and rolled back. The config test checks that every configured seed path exists.

Copy the local API URL and public anon/publishable key from `supabase status` into an ignored `.env.local` file as `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` (or use `VITE_SUPABASE_ANON_KEY` for compatibility), then restart Vite. Never use `supabase link`, `supabase db push`, a hosted database URL, a service-role key, or a production project as part of this local test flow. A hosted deployment and hosted migration have not been configured or run.

The SQL tests are `supabase/tests/tenant_catalog_rls.test.sql` (68 assertions) and `supabase/tests/organization_membership_invitations.test.sql` (42 assertions), 110 pgTAP assertions total. The first suite checks RLS, grants, tenant isolation, organization bootstrap, buyer locations, supplier verification, catalog publishing and edits. The second checks membership/invitation RPC grants, manager and non-member access, SHA-256 token storage, normalized email, seven-day expiry, invitation revocation, matching Auth email, one-time acceptance, and the last-owner guard. `.github/workflows/supabase-db.yml` applies all migrations and runs both suites against a fresh local Postgres instance on pushes and pull requests; it uses no hosted project or secrets. Running the suites locally requires Docker. Docker is not available in the current development environment, so the database layer is not considered verified until the GitHub database CI passes.

## Boundaries and remaining scope

Invitation links are passed manually: the app does not send email and no email provider is configured. The fragment link is valid for 7 days; after signing in with the invited email (case-insensitive match), the user must explicitly accept it in `/account`. Database RPCs consume the invitation atomically once, and an owner/admin can revoke it before acceptance. Owners/admins can manage members and invitations; only owners can grant owner status, and the database prevents demoting or removing the last active owner. Do not log, publish or expose invitation links/tokens; the secret is kept in page memory and removed from the URL fragment when opened. This foundation does not implement account recovery screens, profile identity verification, operator approval, account deletion/retention, orders, procurement history, CSV uploads to a server, notifications, payments, escrow, split settlement, delivery-provider integrations, or market-specific/legal validation. The buyer/supplier screens remain a staged onboarding and catalog foundation, not a claim that the entire product is ready.

## Technical references

- [Supabase Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security): grants decide whether a role can reach a table; RLS policies separately decide which rows it may access. The guide recommends enabling RLS for exposed tables, explicit least-privilege grants and database policy tests.
- [Securing the Supabase Data API](https://supabase.com/docs/guides/api/securing-your-api): use explicit grants together with RLS; revoke unneeded client privileges and keep internal schemas outside the API surface.
- [Supabase CLI configuration](https://supabase.com/docs/guides/local-development/cli/config): `api.schemas` controls local API schema exposure, and `api.auto_expose_new_tables` can require explicit table grants.
- [Supabase changelog: tables are no longer automatically exposed](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically): the platform's automatic table exposure behavior changed, with enforcement on existing projects from 2026-10-30. This implementation does not rely on automatic grants.
