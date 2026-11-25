import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import type { SupplierSuborderWorkflow } from "@/domain/supplierSuborderWorkflow";
import type { Database, Json } from "./database.types";
import type { WorkspaceClient } from "./workspace";
import {
  buyerTermsAdapter,
  canDecideBuyerTerms,
  canReadBuyerTerms,
  listBuyerTermsWorkflows,
  type BuyerTermsRow,
} from "./buyerSuborderTerms";
import { SupplierSuborderClientError } from "./supplierSuborders";

const buyerOrganizationId = "11111111-1111-4111-8111-111111111111";
const buyerRequestId = "22222222-2222-4222-8222-222222222222";
const suborderId = "33333333-3333-4333-8333-333333333333";
const lineId = "44444444-4444-4444-8444-444444444444";
const idempotencyKey = "55555555-5555-4555-8555-555555555555";
const eventId = "66666666-6666-4666-8666-666666666666";
const timestamp = "2026-11-25T09:00:00.000Z";
const scope = {
  organizationId: buyerOrganizationId,
  organizationType: "buyer" as const,
  role: "buyer" as const,
};

const row: BuyerTermsRow = {
  supplier_suborder_id: suborderId,
  status: "awaiting_buyer_decision",
  workflow_version: 3,
  current_terms_version: 2,
  terms_reason: "Synthetic proposed terms",
  response_deadline_at: "2026-11-27T09:00:00.000Z",
  created_at: timestamp,
  updated_at: timestamp,
  lines: [
    {
      buyer_request_line_id: lineId,
      title: "Synthetic flour",
      sell_unit_label: "bag",
      units_per_sell_unit: 1,
      pack_amount: "5.000",
      pack_base_unit: "kg",
      quantity: 4,
      price_amount: "18.2500",
      currency: "KZT",
    },
  ],
};
const workflow: SupplierSuborderWorkflow = {
  supplierSuborderId: suborderId,
  status: "awaiting_buyer_decision",
  workflowVersion: 3,
  currentTermsVersion: 2,
  termsReason: "Synthetic proposed terms",
  responseDeadlineAt: "2026-11-27T09:00:00.000Z",
  createdAt: timestamp,
  updatedAt: timestamp,
  lines: [
    {
      buyerRequestLineId: lineId,
      title: "Synthetic flour",
      sellUnitLabel: "bag",
      unitsPerSellUnit: 1,
      packAmount: "5.000",
      packBaseUnit: "kg",
      quantity: 4,
      priceAmount: "18.2500",
      currency: "KZT",
    },
  ],
};
const receipt: Json = {
  supplier_suborder_id: suborderId,
  status: "buyer_accepted",
  workflow_version: 4,
  current_terms_version: 2,
  event_id: eventId,
  replayed: false,
};

const activeClients: WorkspaceClient[] = [];
let nextKey = 0;
function makeClient(body: Json, status = 200) {
  const requests: { url: string; body: string }[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    requests.push({ url, body: typeof init?.body === "string" ? init.body : "" });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  const client = createClient<Database>(
    "http://buyer-rpc.test",
    "local-publishable-key",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
        storageKey: `sb-buyer-rpc-test-${nextKey++}`,
      },
      global: { fetch: fetcher },
    },
  );
  activeClients.push(client);
  return { client, requests };
}

afterEach(async () => {
  for (const client of activeClients.splice(0)) await client.auth.dispose();
});

describe("buyer terms adapter", () => {
  it("lists only the current buyer request's workflows through the typed RPC", async () => {
    const { client, requests } = makeClient([row]);
    const result = await listBuyerTermsWorkflows(client, scope, buyerRequestId);

    expect(result).toEqual([workflow]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("/rpc/list_buyer_supplier_suborder_workflows");
    expect(JSON.parse(requests[0]!.body)).toEqual({
      p_buyer_organization_id: buyerOrganizationId,
      p_buyer_request_id: buyerRequestId,
    });
  });

  it("gives read access to viewer but no decision rights to viewer/ops/supplier roles", () => {
    expect(canReadBuyerTerms("viewer")).toBe(true);
    for (const role of [
      "viewer",
      "receiver",
      "catalog_operator",
      "order_operator",
    ] as const) {
      expect(canDecideBuyerTerms(role)).toBe(false);
    }
    for (const role of ["owner", "admin", "buyer"] as const) {
      expect(canDecideBuyerTerms(role)).toBe(true);
    }
  });

  it("refuses a decision outside the buyer tenant or with a non-deciding role before RPC", async () => {
    const { client, requests } = makeClient(receipt);
    await expect(
      buyerTermsAdapter.accept(
        client,
        {
          organizationId: buyerOrganizationId,
          organizationType: "supplier",
          role: "owner",
        },
        { workflow, termsVersion: 2, reason: "", idempotencyKey },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      buyerTermsAdapter.reject(
        client,
        { ...scope, role: "viewer" },
        { workflow, termsVersion: 2, reason: "Synthetic reason", idempotencyKey },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(requests).toEqual([]);
  });

  it("accepts the exact live termsVersion with version and idempotency key", async () => {
    const { client, requests } = makeClient(receipt);
    const result = await buyerTermsAdapter.accept(client, scope, {
      workflow,
      termsVersion: 2,
      reason: "",
      idempotencyKey,
    });

    expect(result).toMatchObject({
      status: "buyer_accepted",
      workflowVersion: 4,
      replayed: false,
    });
    expect(requests[0]?.url).toContain("/rpc/accept_buyer_supplier_suborder_version");
    expect(JSON.parse(requests[0]!.body)).toEqual({
      p_buyer_organization_id: buyerOrganizationId,
      p_supplier_suborder_id: suborderId,
      p_terms_version: 2,
      p_expected_version: 3,
      p_idempotency_key: idempotencyKey,
    });
  });

  it("rejects a stale terms version locally and requires a reason for rejection", async () => {
    const { client, requests } = makeClient(receipt);
    await expect(
      buyerTermsAdapter.accept(client, scope, {
        workflow,
        termsVersion: 1,
        reason: "",
        idempotencyKey,
      }),
    ).rejects.toMatchObject({ code: "invalid_transition" });
    await expect(
      buyerTermsAdapter.reject(client, scope, {
        workflow,
        termsVersion: 2,
        reason: "   ",
        idempotencyKey,
      }),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(requests).toEqual([]);
  });

  it("maps a version-conflict RPC error to a safe typed error", async () => {
    const { client } = makeClient(
      { code: "40001", message: "serialization failure with SQL detail" },
      400,
    );
    await expect(
      buyerTermsAdapter.accept(client, scope, {
        workflow,
        termsVersion: 2,
        reason: "",
        idempotencyKey,
      }),
    ).rejects.toBeInstanceOf(SupplierSuborderClientError);
    await expect(
      buyerTermsAdapter.accept(client, scope, {
        workflow,
        termsVersion: 2,
        reason: "",
        idempotencyKey,
      }),
    ).rejects.toMatchObject({ code: "version_conflict" });
  });
});
