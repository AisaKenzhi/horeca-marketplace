import { describe, expect, it, vi } from "vitest";
import type {
  BuyerDraftCartItemRow,
  BuyerDraftCartRow,
  BuyerProcurementRequestLineRow,
  BuyerProcurementRequestRow,
  MembershipRole,
} from "./database.types";
import {
  addBuyerProcurementListItem,
  canManageBuyerProcurement,
  canReadBuyerProcurement,
  createBuyerDraftCartFromList,
  createBuyerProcurementRequest,
  createBuyerProcurementList,
  deleteBuyerDraftCart,
  deleteBuyerProcurementList,
  loadBuyerDraftCarts,
  loadBuyerProcurementRequests,
  loadBuyerProcurementLists,
  removeBuyerDraftCartItem,
  removeBuyerProcurementListItem,
  renameBuyerProcurementList,
  updateBuyerDraftCartLocation,
  updateBuyerDraftCartItemQuantity,
  updateBuyerProcurementListItemQuantity,
  WorkspaceError,
  type WorkspaceClient,
} from "./workspace";

const roles: MembershipRole[] = [
  "owner",
  "admin",
  "buyer",
  "viewer",
  "receiver",
  "order_operator",
  "catalog_operator",
];

function mockClient(
  resultData: unknown = [],
  resultError: unknown = null,
  resultByTable: Record<string, unknown> = {},
) {
  const calls: {
    table: string;
    action: string;
    values?: unknown;
    filters: [string, unknown][];
  }[] = [];
  let current: (typeof calls)[number] | undefined;
  const currentResult = () =>
    current && current.table in resultByTable ? resultByTable[current.table] : resultData;
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  builder.select = () => builder;
  builder.order = () => Promise.resolve({ data: currentResult(), error: resultError });
  builder.eq = (column, value) => {
    current?.filters.push([String(column), value]);
    return builder;
  };
  builder.insert = (values) => {
    if (current) {
      current.action = "insert";
      current.values = values;
    }
    return builder;
  };
  builder.update = (values) => {
    if (current) {
      current.action = "update";
      current.values = values;
    }
    return builder;
  };
  builder.delete = () => {
    if (current) current.action = "delete";
    return builder;
  };
  builder.single = () => Promise.resolve({ data: currentResult(), error: resultError });
  builder.maybeSingle = () =>
    Promise.resolve({
      data: currentResult() === null ? null : { id: "r1" },
      error: resultError,
    });
  const from = vi.fn((table: string) => {
    current = { table, action: "select", filters: [] };
    calls.push(current);
    return builder;
  });
  const rpc = vi.fn().mockResolvedValue({ data: resultData, error: resultError });
  return { client: { from, rpc } as unknown as WorkspaceClient, from, calls, rpc };
}

describe("buyer procurement list access", () => {
  it("allows reads for every buyer-side role and restricts mutations", () => {
    for (const role of roles) {
      expect(canReadBuyerProcurement(role)).toBe(
        ["owner", "admin", "buyer", "viewer"].includes(role),
      );
      expect(canManageBuyerProcurement(role)).toBe(
        ["owner", "admin", "buyer"].includes(role),
      );
    }
  });

  it("loads list and item rows with organization filters", async () => {
    const lists = [{ id: "l1" }];
    const { client, calls } = mockClient(lists);
    const result = await loadBuyerProcurementLists(client, "org-a", "viewer");
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("l1");
    expect(calls.map(({ table, filters }) => [table, filters])).toEqual([
      ["buyer_procurement_lists", [["organization_id", "org-a"]]],
      ["buyer_procurement_list_items", [["organization_id", "org-a"]]],
    ]);
  });

  it("loads persisted draft carts and groups their rows within the tenant", async () => {
    const cart: BuyerDraftCartRow = {
      id: "cart-a",
      organization_id: "org-a",
      buyer_location_id: null,
      source_list_name: "Pantry",
      created_by: "user-a",
      created_at: "2026-11-24T00:00:00.000Z",
      submitted_at: null,
    };
    const item: BuyerDraftCartItemRow = {
      id: "cart-item-a",
      organization_id: "org-a",
      cart_id: "cart-a",
      catalog_offer_id: "offer-a",
      quantity: 4,
      catalog_offer_version: 2,
      created_at: "2026-11-24T00:00:00.000Z",
      updated_at: "2026-11-24T00:00:00.000Z",
    };
    const { client, calls } = mockClient([], null, {
      buyer_draft_carts: [cart],
      buyer_draft_cart_items: [item],
    });

    await expect(loadBuyerDraftCarts(client, "org-a", "viewer")).resolves.toEqual([
      { ...cart, items: [item] },
    ]);
    expect(calls.map(({ table, filters }) => [table, filters])).toEqual([
      ["buyer_draft_carts", [["organization_id", "org-a"]]],
      ["buyer_draft_cart_items", [["organization_id", "org-a"]]],
    ]);
  });

  it("creates a draft cart only through the atomic list-copy RPC", async () => {
    const { client, rpc } = mockClient("cart-a");

    await expect(
      createBuyerDraftCartFromList(client, "org-a", "buyer", "list-a"),
    ).resolves.toBe("cart-a");
    expect(rpc).toHaveBeenCalledWith("create_buyer_draft_cart", {
      p_organization_id: "org-a",
      p_source_list_id: "list-a",
    });
  });

  it("loads buyer-facing request snapshots with organization-scoped queries", async () => {
    const request: BuyerProcurementRequestRow = {
      id: "request-a",
      organization_id: "org-a",
      draft_cart_id: "cart-a",
      buyer_location_id: "location-a",
      buyer_location_name: "Synthetic kitchen",
      buyer_location_address: "Synthetic address",
      buyer_location_delivery_zone: "Warsaw",
      seller_type: "platform",
      request_status: "submitted",
      source_list_name: "Pantry",
      submitted_by: "user-a",
      submitted_at: "2026-11-24T00:00:00.000Z",
    };
    const line: BuyerProcurementRequestLineRow = {
      id: "request-line-a",
      organization_id: "org-a",
      request_id: "request-a",
      catalog_offer_id: "offer-a",
      quantity: 4,
      title: "Flour",
      sell_unit_label: "bag",
      units_per_sell_unit: 1,
      pack_amount: 5,
      pack_base_unit: "kg",
      price_amount: 17.25,
      currency: "KZT",
      availability: "in_stock",
      catalog_offer_version: 2,
      price_observed_at: "2026-11-24T00:00:00.000Z",
      availability_observed_at: "2026-11-24T00:00:00.000Z",
      created_at: "2026-11-24T00:00:00.000Z",
    };
    const { client, calls } = mockClient([], null, {
      buyer_procurement_requests: [request],
      buyer_procurement_request_lines: [line],
    });

    await expect(
      loadBuyerProcurementRequests(client, "org-a", "viewer"),
    ).resolves.toEqual([{ ...request, lines: [line] }]);
    expect(calls.map(({ table, filters }) => [table, filters])).toEqual([
      ["buyer_procurement_requests", [["organization_id", "org-a"]]],
      ["buyer_procurement_request_lines", [["organization_id", "org-a"]]],
    ]);
  });

  it("creates an idempotent request only through the buyer-manager RPC", async () => {
    const requestId = "65000000-0000-4000-8000-000000000001";
    const cartId = "65000000-0000-4000-8000-000000000002";
    const idempotencyKey = "65000000-0000-4000-8000-000000000003";
    const { client, rpc } = mockClient(requestId);

    await expect(
      createBuyerProcurementRequest(client, "org-a", "buyer", cartId, idempotencyKey),
    ).resolves.toBe(requestId);
    expect(rpc).toHaveBeenCalledWith("create_buyer_procurement_request", {
      p_organization_id: "org-a",
      p_cart_id: cartId,
      p_idempotency_key: idempotencyKey,
    });

    const denied = mockClient(requestId);
    await expect(
      createBuyerProcurementRequest(
        denied.client,
        "org-a",
        "viewer",
        cartId,
        idempotencyKey,
      ),
    ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "permission" });
    expect(denied.rpc).not.toHaveBeenCalled();
  });

  it("updates only the selected location on a draft cart scoped to its organization and id", async () => {
    const updatedCart: BuyerDraftCartRow = {
      id: "cart-a",
      organization_id: "org-a",
      buyer_location_id: "location-a",
      source_list_name: "Pantry",
      created_by: "user-a",
      created_at: "2026-11-24T00:00:00.000Z",
      submitted_at: null,
    };
    const { client, calls } = mockClient(updatedCart);

    await expect(
      updateBuyerDraftCartLocation(client, "org-a", "buyer", "cart-a", "location-a"),
    ).resolves.toEqual(updatedCart);
    expect(calls).toEqual([
      {
        table: "buyer_draft_carts",
        action: "update",
        values: { buyer_location_id: "location-a" },
        filters: [
          ["organization_id", "org-a"],
          ["id", "cart-a"],
        ],
      },
    ]);
  });

  it("normalizes names and scopes every mutation to the tenant and resource", async () => {
    const created = { id: "l1", organization_id: "org-a", name: "Pantry" };
    const { client, calls } = mockClient(created);
    await createBuyerProcurementList(client, "org-a", "buyer", "  Pantry  ");
    expect(calls[0]?.values).toEqual({ organization_id: "org-a", name: "Pantry" });
    await renameBuyerProcurementList(client, "org-a", "owner", "l1", "Renamed");
    await deleteBuyerProcurementList(client, "org-a", "admin", "l1");
    await addBuyerProcurementListItem(client, "org-a", "buyer", "l1", "o1", 3);
    await updateBuyerProcurementListItemQuantity(client, "org-a", "admin", "i1", 4);
    await removeBuyerProcurementListItem(client, "org-a", "owner", "i1");
    await deleteBuyerDraftCart(client, "org-a", "owner", "cart-a");
    for (const call of calls.slice(1, 3)) {
      expect(call.filters).toContainEqual(["organization_id", "org-a"]);
      expect(call.filters).toContainEqual(["id", "l1"]);
    }
    expect(calls[3]?.values).toEqual({
      organization_id: "org-a",
      list_id: "l1",
      catalog_offer_id: "o1",
      quantity: 3,
    });
    for (const call of calls.slice(4, 6)) {
      expect(call.filters).toContainEqual(["organization_id", "org-a"]);
      expect(call.filters).toContainEqual(["id", "i1"]);
    }
    expect(calls[6]?.filters).toContainEqual(["organization_id", "org-a"]);
    expect(calls[6]?.filters).toContainEqual(["id", "cart-a"]);
    expect(calls[6]?.table).toBe("buyer_draft_carts");
  });

  it("updates and deletes draft lines through parent-locking RPCs only", async () => {
    const item: BuyerDraftCartItemRow = {
      id: "ci1",
      organization_id: "org-a",
      cart_id: "cart-a",
      catalog_offer_id: "offer-a",
      quantity: 8,
      catalog_offer_version: 2,
      created_at: "2026-11-24T00:00:00.000Z",
      updated_at: "2026-11-24T00:00:00.000Z",
    };
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: "ci1", error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    const base = mockClient(item, null, { buyer_draft_cart_items: item });
    const client = { from: base.from, rpc } as unknown as WorkspaceClient;

    await expect(
      updateBuyerDraftCartItemQuantity(client, "org-a", "buyer", "ci1", 8),
    ).resolves.toEqual(item);
    await expect(
      removeBuyerDraftCartItem(client, "org-a", "admin", "ci1"),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenNthCalledWith(1, "update_buyer_draft_cart_item_quantity", {
      p_organization_id: "org-a",
      p_item_id: "ci1",
      p_quantity: 8,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "delete_buyer_draft_cart_item", {
      p_organization_id: "org-a",
      p_item_id: "ci1",
    });
    expect(base.calls).toHaveLength(1);
    expect(base.calls[0]?.action).toBe("select");
  });

  it("denies every unauthorized role before database access", async () => {
    for (const role of [
      "viewer",
      "receiver",
      "order_operator",
      "catalog_operator",
    ] as MembershipRole[]) {
      const { client, from } = mockClient();
      await expect(
        createBuyerProcurementList(client, "org-a", role, "List"),
      ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "permission" });
      await expect(
        createBuyerDraftCartFromList(client, "org-a", role, "list-a"),
      ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "permission" });
      await expect(
        createBuyerProcurementRequest(
          client,
          "org-a",
          role,
          "65000000-0000-4000-8000-000000000002",
          "65000000-0000-4000-8000-000000000003",
        ),
      ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "permission" });
      await expect(
        updateBuyerDraftCartItemQuantity(client, "org-a", role, "item-a", 2),
      ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "permission" });
      await expect(
        updateBuyerDraftCartLocation(client, "org-a", role, "cart-a", "location-a"),
      ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "permission" });
      expect(from).not.toHaveBeenCalled();
    }
    const { client, from } = mockClient();
    await expect(
      loadBuyerProcurementLists(client, "org-a", "receiver"),
    ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "permission" });
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects invalid names and quantities without database calls", async () => {
    for (const name of ["  ", "x".repeat(121)]) {
      const { client, from } = mockClient();
      await expect(
        createBuyerProcurementList(client, "org-a", "buyer", name),
      ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "invalid" });
      expect(from).not.toHaveBeenCalled();
    }
    const emptyLocation = mockClient();
    await expect(
      updateBuyerDraftCartLocation(
        emptyLocation.client,
        "org-a",
        "buyer",
        "cart-a",
        "  ",
      ),
    ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "invalid" });
    expect(emptyLocation.from).not.toHaveBeenCalled();
    for (const quantity of [
      0,
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      1_000_001,
    ]) {
      const { client, from } = mockClient();
      await expect(
        addBuyerProcurementListItem(client, "org-a", "buyer", "l1", "o1", quantity),
      ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "invalid" });
      expect(from).not.toHaveBeenCalled();
      await expect(
        updateBuyerDraftCartItemQuantity(client, "org-a", "buyer", "item-a", quantity),
      ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "invalid" });
      expect(from).not.toHaveBeenCalled();
      await expect(
        updateBuyerProcurementListItemQuantity(client, "org-a", "buyer", "i1", quantity),
      ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "invalid" });
      expect(from).not.toHaveBeenCalled();
    }
  });

  it("maps database errors and missing records to WorkspaceError", async () => {
    const duplicate = mockClient(null, { code: "23505" });
    await expect(
      createBuyerProcurementList(duplicate.client, "org-a", "buyer", "List"),
    ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "duplicate" });
    const missing = mockClient(null);
    await expect(
      deleteBuyerProcurementList(missing.client, "org-a", "owner", "missing"),
    ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "not_found" });
    const failedRead = mockClient(null, { code: "XX000" });
    await expect(
      loadBuyerProcurementLists(failedRead.client, "org-a", "buyer"),
    ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "unavailable" });
    await expect(
      createBuyerDraftCartFromList(
        mockClient(null, { code: "P0001" }).client,
        "org-a",
        "buyer",
        "list-a",
      ),
    ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "offer_unavailable" });
    await expect(
      createBuyerDraftCartFromList(
        mockClient(null, { code: "P0002" }).client,
        "org-a",
        "buyer",
        "missing-list",
      ),
    ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "not_found" });
  });
});
