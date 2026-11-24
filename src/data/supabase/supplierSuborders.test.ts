import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import type { Json, MembershipRole } from "./database.types";
import type { SupplierSuborderWorkflow } from "@/domain/supplierSuborderWorkflow";
import {
  acceptOwnSupplierSuborder,
  canAccessSupplierSuborderInbox,
  listOwnSupplierSuborders,
  proposeOwnSupplierSuborderVersion,
  rejectOwnSupplierSuborder,
  SupplierSuborderClientError,
  type SupplierSuborderWorkflowRow,
} from "./supplierSuborders";
import type { WorkspaceClient } from "./workspace";

const supplierOrganizationId = "11111111-1111-4111-8111-111111111111";
const suborderId = "22222222-2222-4222-8222-222222222222";
const lineId = "33333333-3333-4333-8333-333333333333";
const idempotencyKey = "44444444-4444-4444-8444-444444444444";
const eventId = "55555555-5555-4555-8555-555555555555";
const timestamp = "2026-11-24T09:00:00.000Z";
const row: SupplierSuborderWorkflowRow = {
  supplier_suborder_id: suborderId,
  status: "awaiting_supplier",
  workflow_version: 1,
  current_terms_version: 1,
  terms_reason: null,
  response_deadline_at: null,
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
const receipt: Json = {
  supplier_suborder_id: suborderId,
  status: "supplier_accepted",
  workflow_version: 2,
  current_terms_version: 1,
  event_id: eventId,
  replayed: false,
};
const workflow: SupplierSuborderWorkflow = {
  supplierSuborderId: suborderId,
  status: "awaiting_supplier",
  workflowVersion: 1,
  currentTermsVersion: 1,
  termsReason: null,
  responseDeadlineAt: null,
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

type RecordedRequest = { readonly url: string; readonly body: string };
const activeClients: WorkspaceClient[] = [];
let nextAuthStorageKey = 0;
function makeClient(
  body: Json,
  status = 200,
): {
  readonly client: WorkspaceClient;
  readonly requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
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
  const client = createClient<import("./database.types").Database>(
    "http://supplier-rpc.test",
    "local-publishable-key",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
        storageKey: `sb-supplier-rpc-test-${nextAuthStorageKey++}`,
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

describe("supplier suborder RPC adapter", () => {
  it("loads and decodes only the selected supplier organization's workflow RPC rows", async () => {
    const { client, requests } = makeClient([row]);
    const result = await listOwnSupplierSuborders(
      client,
      supplierOrganizationId,
      "supplier",
      "order_operator",
    );

    expect(result).toEqual([workflow]);
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toContain("/rpc/list_supplier_suborders");
    expect(JSON.parse(requests[0]!.body)).toEqual({
      p_supplier_organization_id: supplierOrganizationId,
    });
  });

  it("blocks buyer tenants, viewer and catalog-only roles before any RPC call", async () => {
    const deniedRoles: readonly MembershipRole[] = [
      "buyer",
      "viewer",
      "receiver",
      "catalog_operator",
    ];
    for (const role of deniedRoles) {
      expect(canAccessSupplierSuborderInbox(role)).toBe(false);
      const { client, requests } = makeClient([]);
      await expect(
        listOwnSupplierSuborders(client, supplierOrganizationId, "supplier", role),
      ).rejects.toMatchObject({ code: "forbidden" });
      expect(requests).toHaveLength(0);
    }

    const { client, requests } = makeClient([]);
    await expect(
      listOwnSupplierSuborders(client, supplierOrganizationId, "buyer", "owner"),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(requests).toHaveLength(0);
  });

  it("treats a server-denied foreign supplier tenant as forbidden and returns no rows", async () => {
    const foreignOrganizationId = "66666666-6666-4666-8666-666666666666";
    const { client, requests } = makeClient(
      { code: "42501", message: "synthetic foreign tenant data must not be returned" },
      403,
    );
    await expect(
      listOwnSupplierSuborders(
        client,
        foreignOrganizationId,
        "supplier",
        "order_operator",
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(requests).toHaveLength(1);
    expect(JSON.parse(requests[0]!.body)).toEqual({
      p_supplier_organization_id: foreignOrganizationId,
    });
  });

  it("maps accept to a typed RPC call with the current expected version and an idempotency key", async () => {
    const { client, requests } = makeClient(receipt);
    await expect(
      acceptOwnSupplierSuborder(
        client,
        supplierOrganizationId,
        "supplier",
        "admin",
        workflow,
        idempotencyKey,
      ),
    ).resolves.toMatchObject({ status: "supplier_accepted", workflowVersion: 2 });
    expect(requests[0]?.url).toContain("/rpc/accept_supplier_suborder");
    expect(JSON.parse(requests[0]!.body)).toEqual({
      p_supplier_organization_id: supplierOrganizationId,
      p_supplier_suborder_id: suborderId,
      p_expected_version: 1,
      p_idempotency_key: idempotencyKey,
    });
  });

  it("trims a supplier rejection reason and sends the version guard", async () => {
    const rejectionReceipt: Json = {
      ...receipt,
      status: "supplier_rejected",
    };
    const { client, requests } = makeClient(rejectionReceipt);
    await rejectOwnSupplierSuborder(
      client,
      supplierOrganizationId,
      "supplier",
      "order_operator",
      workflow,
      "  No stock in demo  ",
      idempotencyKey,
    );
    expect(requests[0]?.url).toContain("/rpc/reject_supplier_suborder");
    expect(JSON.parse(requests[0]!.body)).toEqual({
      p_supplier_organization_id: supplierOrganizationId,
      p_supplier_suborder_id: suborderId,
      p_reason: "No stock in demo",
      p_expected_version: 1,
      p_idempotency_key: idempotencyKey,
    });
  });

  it("sends a complete proposal with exact decimal strings and refuses unchanged or incomplete terms", async () => {
    const proposalReceipt: Json = {
      ...receipt,
      status: "awaiting_buyer_decision",
      workflow_version: 2,
      current_terms_version: 2,
    };
    const { client, requests } = makeClient(proposalReceipt);
    const deadline = new Date(Date.now() + 86_400_000).toISOString();
    await proposeOwnSupplierSuborderVersion(
      client,
      supplierOrganizationId,
      "supplier",
      "owner",
      workflow,
      "  Updated pack price  ",
      deadline,
      [{ buyerRequestLineId: lineId, quantity: 5, priceAmount: "19.1250" }],
      idempotencyKey,
    );
    expect(requests[0]?.url).toContain("/rpc/propose_supplier_suborder_version");
    expect(JSON.parse(requests[0]!.body)).toEqual({
      p_supplier_organization_id: supplierOrganizationId,
      p_supplier_suborder_id: suborderId,
      p_reason: "Updated pack price",
      p_response_deadline_at: deadline,
      p_lines: [
        {
          buyer_request_line_id: lineId,
          quantity: 5,
          price_amount: "19.1250",
        },
      ],
      p_expected_version: 1,
      p_idempotency_key: idempotencyKey,
    });

    const unchangedClient = makeClient(proposalReceipt);
    await expect(
      proposeOwnSupplierSuborderVersion(
        unchangedClient.client,
        supplierOrganizationId,
        "supplier",
        "owner",
        workflow,
        "Same terms",
        deadline,
        [{ buyerRequestLineId: lineId, quantity: 4, priceAmount: "18.250" }],
        idempotencyKey,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(unchangedClient.requests).toHaveLength(0);

    await expect(
      proposeOwnSupplierSuborderVersion(
        unchangedClient.client,
        supplierOrganizationId,
        "supplier",
        "owner",
        workflow,
        "Missing line",
        deadline,
        [],
        idempotencyKey,
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("maps stale-version and forbidden server replies to safe typed errors", async () => {
    const conflict = makeClient({ code: "40001", message: "private SQL detail" }, 409);
    await expect(
      acceptOwnSupplierSuborder(
        conflict.client,
        supplierOrganizationId,
        "supplier",
        "owner",
        workflow,
        idempotencyKey,
      ),
    ).rejects.toMatchObject({ code: "version_conflict" });
    expect(conflict.requests[0]?.body).not.toContain("private SQL detail");

    const forbidden = makeClient({ code: "42501", message: "private SQL detail" }, 403);
    await expect(
      listOwnSupplierSuborders(
        forbidden.client,
        supplierOrganizationId,
        "supplier",
        "owner",
      ),
    ).rejects.toEqual(expect.any(SupplierSuborderClientError));
    await expect(
      listOwnSupplierSuborders(
        forbidden.client,
        supplierOrganizationId,
        "supplier",
        "owner",
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
