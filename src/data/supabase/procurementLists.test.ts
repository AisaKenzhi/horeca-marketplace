import { describe, expect, it, vi } from "vitest";
import type {
  BuyerDraftCartItemRow,
  BuyerDraftCartRow,
  MembershipRole,
} from "./database.types";
import {
  addBuyerProcurementListItem,
  canManageBuyerProcurement,
  canReadBuyerProcurement,
  createBuyerDraftCartFromList,
  createBuyerProcurementList,
  deleteBuyerDraftCart,
  deleteBuyerProcurementList,
  loadBuyerDraftCarts,
  loadBuyerProcurementLists,
  removeBuyerDraftCartItem,
  removeBuyerProcurementListItem,
  renameBuyerProcurementList,
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
      source_list_name: "Pantry",
      created_by: "user-a",
      created_at: "2026-11-24T00:00:00.000Z",
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
    await updateBuyerDraftCartItemQuantity(client, "org-a", "buyer", "ci1", 8);
    await removeBuyerDraftCartItem(client, "org-a", "admin", "ci1");
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
    for (const call of calls.slice(6, 8)) {
      expect(call.filters).toContainEqual(["organization_id", "org-a"]);
      expect(call.filters).toContainEqual(["id", "ci1"]);
    }
    expect(calls[8]?.filters).toContainEqual(["organization_id", "org-a"]);
    expect(calls[8]?.filters).toContainEqual(["id", "cart-a"]);
    expect(calls[6]?.values).toEqual({ quantity: 8 });
    expect(calls[8]?.table).toBe("buyer_draft_carts");
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
        updateBuyerDraftCartItemQuantity(client, "org-a", role, "item-a", 2),
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
