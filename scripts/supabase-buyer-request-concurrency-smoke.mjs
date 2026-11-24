import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function requireLocalDatabaseUrl(raw) {
  assert.ok(raw, "DB_URL is missing; use the value from local supabase status -o env");
  const parsed = new URL(raw);
  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  const isLoopback =
    hostname === "localhost" || hostname === "::1" || hostname.startsWith("127.");
  assert.ok(
    isLoopback,
    "DB_URL must target loopback only; refusing a non-local database",
  );
  assert.ok(
    ["postgres:", "postgresql:"].includes(parsed.protocol),
    "DB_URL must use the PostgreSQL protocol",
  );
  return parsed;
}

const databaseUrl = requireLocalDatabaseUrl(
  process.env.DB_URL ?? process.env.SUPABASE_DB_URL,
);
const runId = randomUUID().replaceAll("-", "").slice(0, 12);
const appPrefix = `buyer-request-${runId}`;
const ids = {
  buyerOwner: randomUUID(),
  buyerManager: randomUUID(),
  supplierAOwner: randomUUID(),
  supplierBOwner: randomUUID(),
  buyerOrg: randomUUID(),
  supplierAOrg: randomUUID(),
  supplierBOrg: randomUUID(),
  buyerLocation: randomUUID(),
  offerA: randomUUID(),
  offerB: randomUUID(),
  cart: randomUUID(),
  cartItemA: randomUUID(),
  cartItemB: randomUUID(),
  idempotencyKey: randomUUID(),
  workflowAcceptKey: randomUUID(),
  workflowRejectKey: randomUUID(),
};

function connectionString(applicationName) {
  const url = new URL(databaseUrl);
  url.searchParams.set("application_name", applicationName);
  return url.toString();
}

function runPsqlSync(applicationName, args, timeout = 30_000) {
  try {
    return execFileSync(
      "psql",
      [connectionString(applicationName), "-X", "-qAt", "--set=ON_ERROR_STOP=1", ...args],
      { encoding: "utf8", stdio: "pipe", timeout },
    );
  } catch (error) {
    const details = [error.stderr, error.stdout]
      .filter(Boolean)
      .map((value) => String(value).trim())
      .filter(Boolean)
      .join("\n");
    throw new Error(
      `psql failed${details ? `:\n${details}` : ` (${error.code ?? "unknown error"})`}`,
    );
  }
}

function queryDatabase(sql) {
  return runPsqlSync(`${appPrefix}-monitor`, ["--command", sql]).trim();
}

function startPsql(applicationName) {
  const child = spawn(
    "psql",
    [connectionString(applicationName), "-X", "-qAt", "--set=ON_ERROR_STOP=1"],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const details = [stderr, stdout]
        .filter(Boolean)
        .map((value) => value.trim())
        .filter(Boolean)
        .join("\n");
      reject(
        new Error(
          `psql session ${applicationName} failed (code ${code}, signal ${signal ?? "none"})${details ? `:\n${details}` : ""}`,
        ),
      );
    });
  });
  // Sessions are intentionally observed while blocked; their errors are handled
  // after the lock is released, so suppress an early unhandled-rejection warning.
  completion.catch(() => {});
  return {
    child,
    completion,
    get stdout() {
      return stdout;
    },
    get stderr() {
      return stderr;
    },
  };
}

async function waitUntil(predicate, label, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForCompletion(session, timeoutMs = 35_000) {
  let timer;
  try {
    return await Promise.race([
      session.completion,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Timed out waiting for psql session")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function fixtureSql() {
  return `
BEGIN;
INSERT INTO auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at) VALUES
  (:'buyer_owner'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',:'email_buyer_owner','',now()),
  (:'buyer_manager'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',:'email_buyer_manager','',now()),
  (:'supplier_a_owner'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',:'email_supplier_a','',now()),
  (:'supplier_b_owner'::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',:'email_supplier_b','',now());

SELECT set_config('request.jwt.claim.sub', :'buyer_owner', true);
INSERT INTO public.organizations(id,name,organization_type,created_by)
VALUES (:'buyer_org'::uuid, 'CI buyer request ' || :'run_id', 'buyer', :'buyer_owner'::uuid);
INSERT INTO public.organization_memberships(organization_id,user_id,role)
VALUES (:'buyer_org'::uuid, :'buyer_manager'::uuid, 'buyer');

SELECT set_config('request.jwt.claim.sub', :'supplier_a_owner', true);
INSERT INTO public.organizations(id,name,organization_type,created_by)
VALUES (:'supplier_a_org'::uuid, 'CI supplier A ' || :'run_id', 'supplier', :'supplier_a_owner'::uuid);
SELECT set_config('request.jwt.claim.sub', :'supplier_b_owner', true);
INSERT INTO public.organizations(id,name,organization_type,created_by)
VALUES (:'supplier_b_org'::uuid, 'CI supplier B ' || :'run_id', 'supplier', :'supplier_b_owner'::uuid);

INSERT INTO public.supplier_profiles(organization_id,display_name,verification_status) VALUES
  (:'supplier_a_org'::uuid, 'CI Supplier A ' || :'run_id', 'approved'),
  (:'supplier_b_org'::uuid, 'CI Supplier B ' || :'run_id', 'approved');
INSERT INTO public.buyer_locations(id,organization_id,name,address) VALUES
  (:'buyer_location'::uuid, :'buyer_org'::uuid, 'CI kitchen', 'Synthetic test address');
INSERT INTO public.catalog_offers(
  id,supplier_organization_id,supplier_sku,title,category,sell_unit_label,
  units_per_sell_unit,pack_amount,pack_base_unit,price_amount,currency,moq,
  order_step,availability,price_valid_until,is_published
) VALUES
  (:'offer_a'::uuid,:'supplier_a_org'::uuid,'CI-A-' || :'run_id','Synthetic flour','CI test','sack',1,5,'kg',12.50,'PLN',1,1,'in_stock',now()+interval '1 day',true),
  (:'offer_b'::uuid,:'supplier_b_org'::uuid,'CI-B-' || :'run_id','Synthetic oil','CI test','bottle',1,1,'l',20.00,'PLN',1,1,'in_stock',now()+interval '1 day',true);

INSERT INTO public.buyer_draft_carts(id,organization_id,source_list_name,created_by,buyer_location_id)
VALUES (:'cart'::uuid,:'buyer_org'::uuid,'Concurrent CI draft',:'buyer_manager'::uuid,:'buyer_location'::uuid);
INSERT INTO public.buyer_draft_cart_items(id,organization_id,cart_id,catalog_offer_id,quantity,catalog_offer_version) VALUES
  (:'cart_item_a'::uuid,:'buyer_org'::uuid,:'cart'::uuid,:'offer_a'::uuid,2,1),
  (:'cart_item_b'::uuid,:'buyer_org'::uuid,:'cart'::uuid,:'offer_b'::uuid,3,1);
COMMIT;
`;
}

async function setupFixtures() {
  const fixtureDirectory = await mkdtemp(join(tmpdir(), "buyer-request-concurrency-"));
  const fixturePath = join(fixtureDirectory, "fixture.sql");
  const variableValues = {
    buyer_owner: ids.buyerOwner,
    buyer_manager: ids.buyerManager,
    supplier_a_owner: ids.supplierAOwner,
    supplier_b_owner: ids.supplierBOwner,
    buyer_org: ids.buyerOrg,
    supplier_a_org: ids.supplierAOrg,
    supplier_b_org: ids.supplierBOrg,
    buyer_location: ids.buyerLocation,
    offer_a: ids.offerA,
    offer_b: ids.offerB,
    cart: ids.cart,
    cart_item_a: ids.cartItemA,
    cart_item_b: ids.cartItemB,
    run_id: runId,
    email_buyer_owner: `ci-request-owner-${runId}@example.test`,
    email_buyer_manager: `ci-request-manager-${runId}@example.test`,
    email_supplier_a: `ci-request-supplier-a-${runId}@example.test`,
    email_supplier_b: `ci-request-supplier-b-${runId}@example.test`,
  };
  const variables = Object.entries(variableValues).flatMap(([key, value]) => [
    "--set",
    `${key}=${value}`,
  ]);

  try {
    await writeFile(fixturePath, fixtureSql(), { mode: 0o600 });
    runPsqlSync(`${appPrefix}-fixture`, [...variables, "--file", fixturePath], 60_000);
  } finally {
    await rm(fixtureDirectory, { recursive: true, force: true });
  }
}

function cleanupFixtures() {
  const uuid = (value) => `'${value}'::uuid`;
  const sql = `
BEGIN;
ALTER TABLE public.buyer_procurement_requests DISABLE TRIGGER buyer_procurement_requests_immutable;
ALTER TABLE public.buyer_procurement_request_lines DISABLE TRIGGER buyer_procurement_request_lines_immutable;
ALTER TABLE private.platform_supplier_suborders DISABLE TRIGGER platform_supplier_suborders_immutable;
ALTER TABLE private.platform_supplier_suborder_lines DISABLE TRIGGER platform_supplier_suborder_lines_immutable;
ALTER TABLE private.platform_supplier_suborder_workflows DISABLE TRIGGER platform_supplier_suborder_workflows_guard_update;
ALTER TABLE private.platform_supplier_suborder_terms DISABLE TRIGGER platform_supplier_suborder_terms_immutable;
ALTER TABLE private.platform_supplier_suborder_term_lines DISABLE TRIGGER platform_supplier_suborder_term_lines_immutable;
ALTER TABLE private.platform_supplier_suborder_workflow_events DISABLE TRIGGER platform_supplier_suborder_workflow_events_immutable;
ALTER TABLE private.platform_supplier_suborder_action_idempotency DISABLE TRIGGER platform_supplier_suborder_action_idempotency_immutable;
ALTER TABLE public.buyer_draft_carts DISABLE TRIGGER buyer_draft_carts_guard_submission;
ALTER TABLE public.buyer_draft_cart_items DISABLE TRIGGER buyer_draft_cart_items_guard_submission;

-- Workflow-derived rows first: the append-only triggers are disabled only for
-- this synthetic fixture cleanup, and the base request snapshots stay untouched.
DELETE FROM private.platform_supplier_suborder_term_lines WHERE organization_id=${uuid(ids.buyerOrg)};
DELETE FROM private.platform_supplier_suborder_workflow_events WHERE organization_id=${uuid(ids.buyerOrg)};
DELETE FROM private.platform_supplier_suborder_action_idempotency WHERE actor_organization_id IN (${uuid(ids.buyerOrg)}, ${uuid(ids.supplierAOrg)}, ${uuid(ids.supplierBOrg)});
DELETE FROM private.platform_supplier_suborder_terms WHERE organization_id=${uuid(ids.buyerOrg)};
DELETE FROM private.platform_supplier_suborder_workflows WHERE organization_id=${uuid(ids.buyerOrg)};
DELETE FROM private.platform_supplier_suborder_lines WHERE organization_id=${uuid(ids.buyerOrg)};
DELETE FROM private.platform_supplier_suborders WHERE organization_id=${uuid(ids.buyerOrg)};
DELETE FROM public.buyer_procurement_request_lines WHERE organization_id=${uuid(ids.buyerOrg)};
DELETE FROM public.buyer_procurement_requests WHERE organization_id=${uuid(ids.buyerOrg)};
DELETE FROM public.buyer_draft_cart_items WHERE organization_id=${uuid(ids.buyerOrg)};
DELETE FROM public.buyer_draft_carts WHERE organization_id=${uuid(ids.buyerOrg)};
DELETE FROM public.catalog_offers WHERE supplier_organization_id IN (${uuid(ids.supplierAOrg)}, ${uuid(ids.supplierBOrg)});
DELETE FROM public.buyer_locations WHERE organization_id=${uuid(ids.buyerOrg)};
DELETE FROM public.supplier_profiles WHERE organization_id IN (${uuid(ids.supplierAOrg)}, ${uuid(ids.supplierBOrg)});
DELETE FROM public.organizations WHERE id IN (${uuid(ids.buyerOrg)}, ${uuid(ids.supplierAOrg)}, ${uuid(ids.supplierBOrg)});
DELETE FROM auth.users WHERE id IN (${uuid(ids.buyerOwner)}, ${uuid(ids.buyerManager)}, ${uuid(ids.supplierAOwner)}, ${uuid(ids.supplierBOwner)});

ALTER TABLE public.buyer_procurement_requests ENABLE TRIGGER buyer_procurement_requests_immutable;
ALTER TABLE public.buyer_procurement_request_lines ENABLE TRIGGER buyer_procurement_request_lines_immutable;
ALTER TABLE private.platform_supplier_suborders ENABLE TRIGGER platform_supplier_suborders_immutable;
ALTER TABLE private.platform_supplier_suborder_lines ENABLE TRIGGER platform_supplier_suborder_lines_immutable;
ALTER TABLE private.platform_supplier_suborder_workflows ENABLE TRIGGER platform_supplier_suborder_workflows_guard_update;
ALTER TABLE private.platform_supplier_suborder_terms ENABLE TRIGGER platform_supplier_suborder_terms_immutable;
ALTER TABLE private.platform_supplier_suborder_term_lines ENABLE TRIGGER platform_supplier_suborder_term_lines_immutable;
ALTER TABLE private.platform_supplier_suborder_workflow_events ENABLE TRIGGER platform_supplier_suborder_workflow_events_immutable;
ALTER TABLE private.platform_supplier_suborder_action_idempotency ENABLE TRIGGER platform_supplier_suborder_action_idempotency_immutable;
ALTER TABLE public.buyer_draft_carts ENABLE TRIGGER buyer_draft_carts_guard_submission;
ALTER TABLE public.buyer_draft_cart_items ENABLE TRIGGER buyer_draft_cart_items_guard_submission;
COMMIT;
`;
  runPsqlSync(`${appPrefix}-cleanup`, ["--command", sql], 60_000);
}

function blockedSubmitCountQuery() {
  const waiterNames = [1, 2].map((index) => `'${appPrefix}-submit-${index}'`).join(",");
  return `
WITH RECURSIVE wait_chain(submitter_pid, blocker_pid) AS (
  SELECT waiter.pid, blocker.pid
  FROM pg_catalog.pg_stat_activity AS waiter
  CROSS JOIN LATERAL pg_catalog.unnest(pg_catalog.pg_blocking_pids(waiter.pid)) AS blocker(pid)
  WHERE waiter.datname=current_database()
    AND waiter.application_name IN (${waiterNames})
    AND waiter.state='active'
    AND waiter.query LIKE '%public.create_buyer_procurement_request%'
  UNION
  SELECT wait_chain.submitter_pid, blocker.pid
  FROM wait_chain
  CROSS JOIN LATERAL pg_catalog.unnest(pg_catalog.pg_blocking_pids(wait_chain.blocker_pid)) AS blocker(pid)
)
SELECT count(DISTINCT wait_chain.submitter_pid)::text
FROM wait_chain
JOIN pg_catalog.pg_stat_activity AS holder ON holder.pid=wait_chain.blocker_pid
WHERE holder.datname=current_database()
  AND holder.application_name='${appPrefix}-locker';
`;
}

function submitSql() {
  return `
BEGIN;
SET LOCAL lock_timeout='30s';
SET LOCAL statement_timeout='40s';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ids.buyerManager}',true);
SELECT 'REQUEST_RESULT=' || public.create_buyer_procurement_request(
  '${ids.buyerOrg}'::uuid,
  '${ids.cart}'::uuid,
  '${ids.idempotencyKey}'::uuid
)::text;
COMMIT;
`;
}

function supplierWorkflowActionSql(action, suborderId, idempotencyKey) {
  const call =
    action === "accept"
      ? `public.accept_supplier_suborder('${ids.supplierAOrg}'::uuid, '${suborderId}'::uuid, 1, '${idempotencyKey}'::uuid)`
      : `public.reject_supplier_suborder('${ids.supplierAOrg}'::uuid, '${suborderId}'::uuid, 'Synthetic concurrent rejection', 1, '${idempotencyKey}'::uuid)`;
  return `
BEGIN;
SET LOCAL lock_timeout='30s';
SET LOCAL statement_timeout='40s';
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','${ids.supplierAOwner}',false);
DO $action$
DECLARE v_receipt jsonb;
BEGIN
  BEGIN
    v_receipt := ${call};
    RAISE NOTICE 'ACTION_RESULT=success';
  EXCEPTION WHEN SQLSTATE '40001' THEN
    RAISE NOTICE 'ACTION_RESULT=40001';
  END;
END
$action$;
RESET ROLE;
COMMIT;
`;
}

function blockedWorkflowActionCountQuery() {
  const actionNames = ["accept", "reject"]
    .map((action) => `'${appPrefix}-workflow-${action}'`)
    .join(",");
  return `
WITH RECURSIVE wait_chain(waiter_pid, blocker_pid) AS (
  SELECT waiter.pid, blocker.pid
  FROM pg_catalog.pg_stat_activity AS waiter
  CROSS JOIN LATERAL pg_catalog.unnest(pg_catalog.pg_blocking_pids(waiter.pid)) AS blocker(pid)
  WHERE waiter.datname=current_database()
    AND waiter.application_name IN (${actionNames})
    AND waiter.state='active'
    AND (waiter.query LIKE '%public.accept_supplier_suborder%'
      OR waiter.query LIKE '%public.reject_supplier_suborder%')
  UNION
  SELECT wait_chain.waiter_pid, blocker.pid
  FROM wait_chain
  CROSS JOIN LATERAL pg_catalog.unnest(pg_catalog.pg_blocking_pids(wait_chain.blocker_pid)) AS blocker(pid)
)
SELECT count(DISTINCT wait_chain.waiter_pid)::text
FROM wait_chain
JOIN pg_catalog.pg_stat_activity AS holder ON holder.pid=wait_chain.blocker_pid
WHERE holder.datname=current_database()
  AND holder.application_name='${appPrefix}-workflow-locker';
`;
}

function workflowRaceStateQuery(suborderId) {
  const suborder = `'${suborderId}'::uuid`;
  return `
SELECT jsonb_build_object(
  'status', (SELECT status FROM private.platform_supplier_suborder_workflows WHERE supplier_suborder_id=${suborder}),
  'workflow_version', (SELECT workflow_version FROM private.platform_supplier_suborder_workflows WHERE supplier_suborder_id=${suborder}),
  'action_events', (
    SELECT count(*)::integer FROM private.platform_supplier_suborder_workflow_events
    WHERE supplier_suborder_id=${suborder}
      AND event_type IN ('supplier_accepted','supplier_rejected')
  ),
  'action_receipts', (
    SELECT count(*)::integer FROM private.platform_supplier_suborder_action_idempotency
    WHERE supplier_suborder_id=${suborder}
      AND operation IN ('supplier_accept','supplier_reject')
  ),
  'receipt_operations', (
    SELECT jsonb_agg(operation ORDER BY operation)
    FROM private.platform_supplier_suborder_action_idempotency
    WHERE supplier_suborder_id=${suborder}
      AND operation IN ('supplier_accept','supplier_reject')
  )
)::text;
`;
}

function submittedRequestCountsQuery() {
  const buyerOrg = `'${ids.buyerOrg}'::uuid`;
  const cart = `'${ids.cart}'::uuid`;
  const idempotencyKey = `'${ids.idempotencyKey}'::uuid`;
  return `
SELECT jsonb_build_object(
  'parents', (
    SELECT count(*)::integer FROM public.buyer_procurement_requests
    WHERE organization_id=${buyerOrg} AND idempotency_key=${idempotencyKey}
  ),
  'request_id', (
    SELECT id::text FROM public.buyer_procurement_requests
    WHERE organization_id=${buyerOrg} AND idempotency_key=${idempotencyKey}
  ),
  'request_lines', (
    SELECT count(*)::integer FROM public.buyer_procurement_request_lines AS line
    JOIN public.buyer_procurement_requests AS request
      ON request.organization_id=line.organization_id AND request.id=line.request_id
    WHERE request.organization_id=${buyerOrg} AND request.idempotency_key=${idempotencyKey}
  ),
  'supplier_suborders', (
    SELECT count(*)::integer FROM private.platform_supplier_suborders AS suborder
    JOIN public.buyer_procurement_requests AS request
      ON request.organization_id=suborder.organization_id AND request.id=suborder.buyer_request_id
    WHERE request.organization_id=${buyerOrg} AND request.idempotency_key=${idempotencyKey}
  ),
  'supplier_suborder_lines', (
    SELECT count(*)::integer FROM private.platform_supplier_suborder_lines AS line
    JOIN public.buyer_procurement_requests AS request
      ON request.organization_id=line.organization_id AND request.id=line.buyer_request_id
    WHERE request.organization_id=${buyerOrg} AND request.idempotency_key=${idempotencyKey}
  ),
  'distinct_suppliers', (
    SELECT count(DISTINCT suborder.supplier_organization_id)::integer
    FROM private.platform_supplier_suborders AS suborder
    JOIN public.buyer_procurement_requests AS request
      ON request.organization_id=suborder.organization_id AND request.id=suborder.buyer_request_id
    WHERE request.organization_id=${buyerOrg} AND request.idempotency_key=${idempotencyKey}
  ),
  'cart_frozen', coalesce((
    SELECT submitted_at IS NOT NULL FROM public.buyer_draft_carts
    WHERE organization_id=${buyerOrg} AND id=${cart}
  ), false)
)::text;
`;
}

async function releaseLocker(session, command = "ROLLBACK;") {
  if (!session || session.child.exitCode !== null || session.child.stdin.destroyed)
    return;
  session.child.stdin.write(`${command}\n\\q\n`);
  session.child.stdin.end();
  await waitForCompletion(session, 10_000);
}

async function main() {
  let locker;
  let workflowLocker;
  let fixtureCreated = false;
  const submitSessions = [];
  const workflowActionSessions = [];
  try {
    await setupFixtures();
    fixtureCreated = true;

    locker = startPsql(`${appPrefix}-locker`);
    locker.child.stdin.write(`
BEGIN;
SET LOCAL lock_timeout='30s';
SELECT id FROM public.buyer_draft_carts WHERE organization_id='${ids.buyerOrg}'::uuid AND id='${ids.cart}'::uuid FOR UPDATE;
SELECT 'CART_LOCK_ACQUIRED';
`);
    await waitUntil(
      () => locker.stdout.includes("CART_LOCK_ACQUIRED"),
      "the explicit parent cart-row lock",
    );

    for (const index of [1, 2]) {
      const session = startPsql(`${appPrefix}-submit-${index}`);
      submitSessions.push(session);
      session.child.stdin.end(submitSql());
    }

    await waitUntil(async () => {
      const exited = submitSessions.find((session) => session.child.exitCode !== null);
      if (exited) {
        throw new Error(
          `A submit session exited before the lock barrier: stdout=${exited.stdout.trim()} stderr=${exited.stderr.trim()}`,
        );
      }
      return Number(queryDatabase(blockedSubmitCountQuery())) === 2;
    }, "both submit sessions to wait on the held cart-row lock");

    await releaseLocker(locker, "COMMIT;");
    locker = undefined;
    const results = await Promise.all(
      submitSessions.map((session) => waitForCompletion(session)),
    );
    const returnedIds = results.map(({ stdout }) => {
      const match = stdout.match(/^REQUEST_RESULT=([0-9a-f-]{36})$/m);
      assert.ok(match, `submit session did not return a request UUID: ${stdout.trim()}`);
      return match[1];
    });
    assert.equal(
      returnedIds[0],
      returnedIds[1],
      "both concurrent calls must return the same request ID",
    );

    const counts = JSON.parse(queryDatabase(submittedRequestCountsQuery()));
    assert.deepEqual(counts, {
      parents: 1,
      request_id: returnedIds[0],
      request_lines: 2,
      supplier_suborders: 2,
      supplier_suborder_lines: 2,
      distinct_suppliers: 2,
      cart_frozen: true,
    });

    const workflowSuborderId = queryDatabase(`
SELECT id::text FROM private.platform_supplier_suborders
WHERE buyer_request_id='${returnedIds[0]}'::uuid
  AND supplier_organization_id='${ids.supplierAOrg}'::uuid
LIMIT 1;
`);
    assert.match(workflowSuborderId, /^[0-9a-f-]{36}$/i);

    workflowLocker = startPsql(`${appPrefix}-workflow-locker`);
    workflowLocker.child.stdin.write(`
BEGIN;
SET LOCAL lock_timeout='30s';
SELECT supplier_suborder_id
FROM private.platform_supplier_suborder_workflows
WHERE supplier_suborder_id='${workflowSuborderId}'::uuid
FOR UPDATE;
SELECT 'WORKFLOW_LOCK_ACQUIRED';
`);
    await waitUntil(
      () => workflowLocker.stdout.includes("WORKFLOW_LOCK_ACQUIRED"),
      "the explicit supplier workflow-row lock",
    );

    const competingActions = [
      ["accept", ids.workflowAcceptKey],
      ["reject", ids.workflowRejectKey],
    ];
    for (const [action, idempotencyKey] of competingActions) {
      const session = startPsql(`${appPrefix}-workflow-${action}`);
      workflowActionSessions.push(session);
      session.child.stdin.end(
        supplierWorkflowActionSql(action, workflowSuborderId, idempotencyKey),
      );
    }

    await waitUntil(async () => {
      const exited = workflowActionSessions.find(
        (session) => session.child.exitCode !== null,
      );
      if (exited) {
        throw new Error(
          `A workflow action exited before the lock barrier: stdout=${exited.stdout.trim()} stderr=${exited.stderr.trim()}`,
        );
      }
      return Number(queryDatabase(blockedWorkflowActionCountQuery())) === 2;
    }, "both workflow actions to wait on the same held workflow row");

    await releaseLocker(workflowLocker, "COMMIT;");
    workflowLocker = undefined;
    const actionResults = await Promise.all(
      workflowActionSessions.map((session) => waitForCompletion(session)),
    );
    const actionOutcomes = actionResults.map(({ stdout, stderr }) => {
      const match = `${stdout}\n${stderr}`.match(/ACTION_RESULT=(success|40001)/);
      assert.ok(match, `workflow action emitted no result marker: ${stdout}\n${stderr}`);
      return match[1];
    });
    assert.deepEqual(
      actionOutcomes.sort(),
      ["40001", "success"],
      "exactly one version-1 supplier action must succeed and the other must fail with SQLSTATE 40001",
    );

    const workflowState = JSON.parse(
      queryDatabase(workflowRaceStateQuery(workflowSuborderId)),
    );
    assert.ok(
      ["supplier_accepted", "supplier_rejected"].includes(workflowState.status),
      `unexpected final workflow status: ${workflowState.status}`,
    );
    assert.equal(workflowState.workflow_version, 2);
    assert.equal(workflowState.action_events, 1);
    assert.equal(workflowState.action_receipts, 1);
    assert.deepEqual(workflowState.receipt_operations, [
      workflowState.status === "supplier_accepted"
        ? "supplier_accept"
        : "supplier_reject",
    ]);

    console.log(
      "Local Postgres concurrency smoke passed: concurrent buyer submits persisted one request; competing supplier accept/reject actions at expectedVersion 1 produced one success, one SQLSTATE 40001, workflow version 2, one audit event, and one receipt.",
    );
  } finally {
    if (locker) {
      try {
        await releaseLocker(locker);
      } catch {
        locker.child.kill("SIGTERM");
      }
    }
    if (workflowLocker) {
      try {
        await releaseLocker(workflowLocker);
      } catch {
        workflowLocker.child.kill("SIGTERM");
      }
    }
    for (const session of submitSessions) {
      if (session.child.exitCode === null) session.child.kill("SIGTERM");
      await session.completion.catch(() => {});
    }
    for (const session of workflowActionSessions) {
      if (session.child.exitCode === null) session.child.kill("SIGTERM");
      await session.completion.catch(() => {});
    }
    if (fixtureCreated) cleanupFixtures();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
