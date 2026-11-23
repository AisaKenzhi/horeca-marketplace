# Local account and Supabase developer workflow

This runbook complements [the tenant foundation overview](tenant-foundation.md). It describes the optional authenticated `/account` workspace and its local checks; the default demo continues to use synthetic in-browser data.

## Prerequisites

- Node.js `>=20.19` and npm `>=10` (see `package.json` and `README.md`).
- Docker running locally and the Supabase CLI available. The CLI is not a project dependency; check it with `npx supabase --version` and consult the [Supabase CLI installation guide](https://supabase.com/docs/guides/cli).
- From the repository root, install the locked JavaScript dependencies:

```bash
npm ci
```

## Start the local backend

The repository's Supabase configuration uses local API, database, and Studio ports `54321`, `54322`, and `54323`. The local Auth site and redirect URL are `http://127.0.0.1:5173`.

```bash
npx supabase start
npx supabase db reset --no-seed
npx supabase test db
npx supabase status
```

These commands target the local stack by default. `db reset` rebuilds the local database from the checked-in migrations and discards its current local database state. `--no-seed` is intentional: the configured `supabase/seed.sql` is deliberately empty, and the pgTAP suites create synthetic identities and rows inside transactions. Do not assume there is application seed data. The CLI's `test db` command runs all pgTAP suites against the local stack.

Do not add `--remote`/`--db-url`, run `supabase link` or `supabase db push`, or point this workflow at a hosted or production project. This runbook does not configure or migrate a hosted database.

## Configure and open `/account`

Copy the example into the ignored local environment file:

```bash
cp .env.example .env.local
```

Fill in the local API URL and **one** browser-safe key from `npx supabase status`:

```dotenv
VITE_SUPABASE_URL=http://127.0.0.1:54321
VITE_SUPABASE_PUBLISHABLE_KEY=<local-publishable-key>
# Alternative for compatibility if status provides an anon key:
# VITE_SUPABASE_ANON_KEY=<local-anon-key>
```

The app needs `VITE_SUPABASE_URL` plus either `VITE_SUPABASE_PUBLISHABLE_KEY` or the legacy `VITE_SUPABASE_ANON_KEY`; the publishable key takes precedence if both are set. `.env.local` is ignored by Git. Vite-prefixed values are bundled for the browser, so never place a `service_role` key or any secret key in this file. The no-Supabase configuration remains a demo/configuration-only mode.

Start the app and visit `http://127.0.0.1:5173/account`:

```bash
npm run dev
```

Use a local test email and password (the account form requires at least 8 characters). The checked-in local Auth config has email confirmations disabled. After signing in, create a buyer or supplier organization; the database adds its creator as the initial owner. The demo-persona selector is separate and does not authenticate the account workspace.

## Run the relevant checks

The focused UI and input-validation tests do not require a Supabase server or real credentials:

```bash
npm test -- tests/account.ui.test.tsx tests/account.validation.test.ts
```

For the full JavaScript quality gate, run the same checks used by CI:

```bash
npm run format
npm run lint
npm run typecheck
npm run test:coverage
npm run build
```

Or use `npm run verify:full`, which runs those five checks in that order. `npm run verify` is a shorter gate: lint, typecheck, unit tests, and build; it does not include format or coverage. The account UI/validation tests are not a substitute for the database policy suite.

The local database/RLS check is:

```bash
npx supabase test db
```

It runs both `supabase/tests/tenant_catalog_rls.test.sql` (68 assertions) and `supabase/tests/organization_membership_invitations.test.sql` (42 assertions), 110 pgTAP assertions total, against the local Supabase stack. The second suite covers management permissions, token hashing, email matching, single-use acceptance, expiry/revocation and last-owner safeguards. It requires Docker and a successful local `start`/`db reset`; it does not test hosted data.

The Playwright suite is an additional app-level check, not an authenticated Supabase integration test. Install Chromium once if needed, then run the build and E2E suite against the local preview server:

```bash
npm run e2e:install
npm run e2e:ci
```

To stop the local stack when finished, run `npx supabase stop`.

## What is and is not covered

Owners and admins can list organization members and pending invitations, change member roles and remove members; only an owner can grant the owner role. The database blocks demoting or removing the last active owner. There is no email provider: after creating an invitation, copy its link and deliver it to the invitee manually through a channel you choose. The link is valid for 7 days. The invitee must sign in or register with the invited email address (case-insensitive), then explicitly press **Accept invitation** in `/account`. Acceptance is atomic and one-time. Owners/admins can revoke an unused invitation. Do not publish the link or place its URL/token in logs, screenshots or analytics. The token is held only in page memory; copy it before closing or reloading the page. See the [tenant foundation overview](tenant-foundation.md).
