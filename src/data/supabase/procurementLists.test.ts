import { describe, expect, it, vi } from "vitest";
import type { MembershipRole } from "./database.types";
import {
  addBuyerProcurementListItem,
  canManageBuyerProcurement,
  canReadBuyerProcurement,
  createBuyerProcurementList,
  deleteBuyerProcurementList,
  loadBuyerProcurementLists,
  removeBuyerProcurementListItem,
  renameBuyerProcurementList,
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

function mockClient(resultData: unknown = [], resultError: unknown = null) {
  const calls: {
    table: string;
    action: string;
    values?: unknown;
    filters: [string, unknown][];
  }[] = [];
  let current: (typeof calls)[number] | undefined;
  const builder: Record<string, (...args: unknown[]) => unknown> = {};
  builder.select = () => builder;
  builder.order = () => Promise.resolve({ data: resultData, error: resultError });
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
  builder.single = () => Promise.resolve({ data: resultData, error: resultError });
  builder.maybeSingle = () =>
    Promise.resolve({
      data: resultData === null ? null : { id: "r1" },
      error: resultError,
    });
  const from = vi.fn((table: string) => {
    current = { table, action: "select", filters: [] };
    calls.push(current);
    return builder;
  });
  return { client: { from } as unknown as WorkspaceClient, from, calls };
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
    for (const call of calls.slice(4)) {
      expect(call.filters).toContainEqual(["organization_id", "org-a"]);
      expect(call.filters).toContainEqual(["id", "i1"]);
    }
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
  });
});
