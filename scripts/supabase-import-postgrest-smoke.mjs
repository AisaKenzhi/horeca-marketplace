import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const apiUrl = process.env.API_URL ?? process.env.SUPABASE_URL;
const databaseUrl = process.env.DB_URL ?? process.env.SUPABASE_DB_URL;
const anonKey = process.env.ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
const jwtSecret = process.env.JWT_SECRET;

function requireLocalUrl(raw, label, protocols) {
  assert.ok(raw, `${label} is missing; use values from local supabase status -o env`);
  const parsed = new URL(raw);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const loopback =
    hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
  assert.ok(loopback, `${label} must target loopback only; refusing ${parsed.host}`);
  assert.ok(protocols.includes(parsed.protocol), `${label} uses an unexpected protocol`);
  return parsed;
}

const api = requireLocalUrl(apiUrl, "API_URL", ["http:"]);
const db = requireLocalUrl(databaseUrl, "DB_URL", ["postgres:", "postgresql:"]);
assert.ok(anonKey, "ANON_KEY is missing; use values from local supabase status -o env");
assert.ok(
  jwtSecret && jwtSecret.length >= 32,
  "local JWT_SECRET is missing or too short",
);

const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const ids = {
  ownerA: randomUUID(),
  operatorA: randomUUID(),
  operatorB: randomUUID(),
  ownerB: randomUUID(),
  orgA: randomUUID(),
  orgB: randomUUID(),
  productB: randomUUID(),
};
const emails = {
  ownerA: `ci-import-owner-${runId}@example.test`,
  operatorA: `ci-import-a-${runId}@example.test`,
  operatorB: `ci-import-b-${runId}@example.test`,
  ownerB: `ci-import-foreign-${runId}@example.test`,
};
const raceSku = `CI-RACE-${runId}`;
const foreignSku = `CI-FOREIGN-${runId}`;
const raceTitle = `CI race product ${runId}`;
const orgAName = `CI import supplier ${runId}`;
const orgBName = `CI foreign supplier ${runId}`;
const fixturePath = resolve(
  tmpdir(),
  `supplier-import-fixture-${process.pid}-${runId}.sql`,
);

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function psql(args, options = {}) {
  return execFileSync(
    "psql",
    [db.toString(), "-X", "--no-psqlrc", "--set=ON_ERROR_STOP=1", ...args],
    {
      cwd: root,
      encoding: "utf8",
      stdio: options.stdio ?? "pipe",
      timeout: options.timeout ?? 30_000,
    },
  );
}

function queryDatabase(sql) {
  return psql(["--tuples-only", "--no-align", "--command", sql]).trim();
}

function encodePart(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function makeJwt(role, userId) {
  const now = Math.floor(Date.now() / 1000);
  const header = encodePart({ alg: "HS256", typ: "JWT" });
  const payload = encodePart({
    iss: `${api.origin}/auth/v1`,
    aud: "authenticated",
    role,
    ...(userId ? { sub: userId } : {}),
    iat: now,
    exp: now + 600,
  });
  const content = `${header}.${payload}`;
  const signature = createHmac("sha256", jwtSecret).update(content).digest("base64url");
  return `${content}.${signature}`;
}

const tokens = {
  anon: makeJwt("anon"),
  operatorA: makeJwt("authenticated", ids.operatorA),
  operatorB: makeJwt("authenticated", ids.operatorB),
};

async function request(path, { token, method = "GET", body } = {}) {
  const headers = {
    apikey: anonKey,
    accept: "application/json",
  };
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(new URL(path, api), {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  return { status: response.status, ok: response.ok, payload };
}

function assertDenied(result, label) {
  assert.ok(!result.ok, `${label} unexpectedly succeeded`);
  assert.ok(result.status >= 400, `${label} returned an unexpected status`);
}

async function rpc(name, token, payload) {
  return request(`/rest/v1/rpc/${name}`, { token, method: "POST", body: payload });
}

async function waitForActivity(sql, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const count = Number(queryDatabase(sql));
    if (count > 0) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error(`Timed out waiting for local Postgres activity: ${label}`);
}

function fixtureSql() {
  return `
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at) VALUES
  (:'owner_a'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',:'email_owner_a','',now()),
  (:'operator_a'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',:'email_operator_a','',now()),
  (:'operator_b'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',:'email_operator_b','',now()),
  (:'owner_b'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',:'email_owner_b','',now());
SELECT set_config('request.jwt.claim.sub', :'owner_a', true);
INSERT INTO public.organizations(id,name,organization_type,created_by)
VALUES (:'org_a'::uuid, :'org_a_name', 'supplier', :'owner_a'::uuid);
INSERT INTO public.supplier_profiles(organization_id,display_name,verification_status)
VALUES (:'org_a'::uuid, :'org_a_name', 'approved');
INSERT INTO public.organization_memberships(organization_id,user_id,role) VALUES
  (:'org_a'::uuid, :'operator_a'::uuid, 'catalog_operator'),
  (:'org_a'::uuid, :'operator_b'::uuid, 'catalog_operator');
SELECT set_config('request.jwt.claim.sub', :'owner_b', true);
INSERT INTO public.organizations(id,name,organization_type,created_by)
VALUES (:'org_b'::uuid, :'org_b_name', 'supplier', :'owner_b'::uuid);
INSERT INTO public.supplier_profiles(organization_id,display_name,verification_status)
VALUES (:'org_b'::uuid, :'org_b_name', 'approved');
INSERT INTO public.catalog_products(id,name,category)
VALUES (:'product_b'::uuid, :'foreign_title', 'CI fixture');
INSERT INTO public.catalog_offers(
  supplier_organization_id,product_id,supplier_sku,title,category,
  sell_unit_label,units_per_sell_unit,pack_amount,pack_base_unit,
  price_amount,currency,moq,order_step,availability,is_published
) VALUES (
  :'org_b'::uuid, :'product_b'::uuid, :'foreign_sku', :'foreign_title', 'CI fixture',
  'box', 1, 1, 'kg', 10, 'PLN', 1, 1, 'unknown', false
);
CREATE TABLE private.supplier_catalog_import_ci_delays(
  sku text PRIMARY KEY,
  sleep_seconds double precision NOT NULL
);
INSERT INTO private.supplier_catalog_import_ci_delays(sku,sleep_seconds)
VALUES (:'race_sku', 3.0);
CREATE OR REPLACE FUNCTION private.supplier_catalog_import_ci_delay()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_sleep double precision;
BEGIN
  SELECT delay.sleep_seconds INTO v_sleep
  FROM private.supplier_catalog_import_ci_delays AS delay
  WHERE delay.sku = NEW.supplier_sku;
  IF v_sleep IS NOT NULL THEN
    PERFORM pg_catalog.pg_sleep(v_sleep);
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER supplier_catalog_import_ci_delay
BEFORE INSERT ON public.catalog_offers
FOR EACH ROW EXECUTE FUNCTION private.supplier_catalog_import_ci_delay();
COMMIT;
`;
}

function setupFixtures() {
  const psqlVariables = {
    owner_a: ids.ownerA,
    operator_a: ids.operatorA,
    operator_b: ids.operatorB,
    owner_b: ids.ownerB,
    org_a: ids.orgA,
    org_b: ids.orgB,
    product_b: ids.productB,
    email_owner_a: emails.ownerA,
    email_operator_a: emails.operatorA,
    email_operator_b: emails.operatorB,
    email_owner_b: emails.ownerB,
    org_a_name: orgAName,
    org_b_name: orgBName,
    foreign_sku: foreignSku,
    foreign_title: `CI foreign product ${runId}`,
    race_sku: raceSku,
  };
  return writeFile(fixturePath, fixtureSql(), { mode: 0o600 }).then(() => {
    const variableArgs = Object.entries(psqlVariables).flatMap(([key, value]) => [
      "--set",
      `${key}=${value}`,
    ]);
    psql([...variableArgs, "--file", fixturePath], { stdio: "inherit", timeout: 60_000 });
  });
}

function cleanupFixtures() {
  const sql = `
DROP TRIGGER IF EXISTS supplier_catalog_import_ci_delay ON public.catalog_offers;
DROP FUNCTION IF EXISTS private.supplier_catalog_import_ci_delay();
DROP TABLE IF EXISTS private.supplier_catalog_import_ci_delays;
DELETE FROM public.organizations WHERE id IN (${sqlString(ids.orgA)}::uuid, ${sqlString(ids.orgB)}::uuid);
DELETE FROM public.catalog_products WHERE id = ${sqlString(ids.productB)}::uuid OR name = ${sqlString(raceTitle)};
DELETE FROM auth.users WHERE id IN (
  ${sqlString(ids.ownerA)}::uuid, ${sqlString(ids.operatorA)}::uuid,
  ${sqlString(ids.operatorB)}::uuid, ${sqlString(ids.ownerB)}::uuid
);
`;
  psql(["--command", sql], { timeout: 60_000 });
}

async function main() {
  await setupFixtures();
  try {
    const anonRpc = await rpc("preview_supplier_catalog_import", tokens.anon, {
      p_organization_id: ids.orgA,
      p_idempotency_key: randomUUID(),
      p_rows: [],
    });
    assertDenied(anonRpc, "anonymous preview RPC");

    const stagingRead = await request(
      "/rest/v1/supplier_catalog_imports?select=id&limit=1",
      {
        token: tokens.operatorA,
      },
    );
    assertDenied(stagingRead, "authenticated direct staging-table read");

    const stagingInsert = await request("/rest/v1/supplier_catalog_imports", {
      token: tokens.operatorA,
      method: "POST",
      body: {},
    });
    assertDenied(stagingInsert, "authenticated direct staging-table insert");

    const foreignOffers = await request(
      `/rest/v1/catalog_offers?select=supplier_sku&supplier_organization_id=eq.${ids.orgB}&limit=10`,
      { token: tokens.operatorA },
    );
    assert.ok(
      foreignOffers.ok,
      `tenant offer read failed: ${JSON.stringify(foreignOffers.payload)}`,
    );
    assert.deepEqual(
      foreignOffers.payload,
      [],
      "RLS hides another supplier's unpublished offer",
    );

    const foreignProducts = await request(
      `/rest/v1/catalog_products?select=id&id=eq.${ids.productB}&limit=10`,
      { token: tokens.operatorA },
    );
    assert.ok(
      foreignProducts.ok,
      `product read failed: ${JSON.stringify(foreignProducts.payload)}`,
    );
    assert.deepEqual(
      foreignProducts.payload,
      [],
      "Product RLS hides a product with no tenant-visible offer",
    );

    const crossTenant = await rpc("preview_supplier_catalog_import", tokens.operatorA, {
      p_organization_id: ids.orgB,
      p_idempotency_key: randomUUID(),
      p_rows: [],
    });
    assertDenied(crossTenant, "cross-tenant preview RPC");
    assert.equal(
      crossTenant.payload?.code,
      "42501",
      "cross-tenant RPC must be denied by database authorization",
    );

    const row = {
      row_number: 1,
      values: {
        sku: raceSku,
        title: raceTitle,
        category: "CI fixture",
        sell_unit_label: "box",
        units_per_sell_unit: "1",
        pack_amount: "2",
        pack_base_unit: "kg",
        price_amount: "10",
        currency: "PLN",
        moq: "1",
        order_step: "1",
        availability: "unknown",
      },
      client_errors: [],
    };
    const previewA = await rpc("preview_supplier_catalog_import", tokens.operatorA, {
      p_organization_id: ids.orgA,
      p_idempotency_key: randomUUID(),
      p_rows: [row],
    });
    const previewB = await rpc("preview_supplier_catalog_import", tokens.operatorB, {
      p_organization_id: ids.orgA,
      p_idempotency_key: randomUUID(),
      p_rows: [row],
    });
    assert.ok(previewA.ok, `first preview failed: ${JSON.stringify(previewA.payload)}`);
    assert.ok(previewB.ok, `second preview failed: ${JSON.stringify(previewB.payload)}`);
    assert.equal(previewA.payload.status, "previewed");
    assert.equal(previewB.payload.status, "previewed");
    assert.notEqual(previewA.payload.import_id, previewB.payload.import_id);

    const applyA = rpc("apply_supplier_catalog_import", tokens.operatorA, {
      p_organization_id: ids.orgA,
      p_import_id: previewA.payload.import_id,
    });
    await waitForActivity(
      `SELECT count(*) FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event = 'PgSleep'
         AND position('apply_supplier_catalog_import' IN query) > 0`,
      "first apply paused inside the test-only offer trigger",
    );
    const applyB = rpc("apply_supplier_catalog_import", tokens.operatorB, {
      p_organization_id: ids.orgA,
      p_import_id: previewB.payload.import_id,
    });
    await waitForActivity(
      `SELECT count(*) FROM pg_stat_activity
       WHERE datname = current_database() AND wait_event_type = 'Lock'
         AND wait_event = 'advisory'
         AND position('apply_supplier_catalog_import' IN query) > 0`,
      "second apply waiting on the tenant/SKU advisory lock",
    );
    const [resultA, resultB] = await Promise.all([applyA, applyB]);
    const outcomes = [resultA, resultB];
    const applied = outcomes.filter(
      (result) => result.ok && result.payload?.status === "applied",
    );
    const stale = outcomes.filter(
      (result) => !result.ok && result.payload?.code === "40001",
    );
    assert.equal(applied.length, 1, "exactly one competing SKU import must apply");
    assert.equal(
      stale.length,
      1,
      "the losing preview must fail as stale (40001), not unique violation",
    );

    const offers = await request(
      `/rest/v1/catalog_offers?select=id,product_id&supplier_organization_id=eq.${ids.orgA}&supplier_sku=eq.${encodeURIComponent(raceSku)}&limit=10`,
      { token: tokens.operatorA },
    );
    assert.ok(offers.ok, `final offer read failed: ${JSON.stringify(offers.payload)}`);
    assert.equal(offers.payload.length, 1, "one offer exists for the tenant/SKU");
    assert.ok(offers.payload[0].product_id, "the offer links to a Product record");

    const products = await request(
      `/rest/v1/catalog_products?select=id&id=eq.${offers.payload[0].product_id}&limit=10`,
      { token: tokens.operatorA },
    );
    assert.ok(
      products.ok,
      `final Product read failed: ${JSON.stringify(products.payload)}`,
    );
    assert.equal(products.payload.length, 1, "one linked Product exists after the race");

    console.log(
      "Local PostgREST supplier import smoke passed: API grants, staging denial, tenant RLS, and a two-preview same-SKU race.",
    );
  } finally {
    try {
      cleanupFixtures();
    } finally {
      await unlink(fixturePath).catch(() => {});
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
