import { describe, expect, it, vi } from "vitest";
import type {
  CatalogOfferRow,
  MembershipRole,
  OrganizationType,
  VerificationStatus,
} from "./database.types";
import {
  canManageSupplierCatalog,
  updateCatalogOfferTerms,
  WorkspaceError,
  type WorkspaceClient,
} from "./workspace";

const updatedOffer: CatalogOfferRow = {
  id: "offer-1",
  supplier_organization_id: "supplier-1",
  supplier_sku: "SKU-1",
  title: "Flour",
  category: "Grocery",
  sell_unit_label: "bag",
  units_per_sell_unit: 1,
  pack_amount: 5,
  pack_base_unit: "kg",
  price_amount: 17.25,
  currency: "KZT",
  moq: 1,
  order_step: 1,
  availability: "low_stock",
  price_valid_until: null,
  is_published: true,
  price_observed_at: "2026-11-24T00:00:00.000Z",
  availability_observed_at: "2026-11-24T00:00:00.000Z",
  version: 2,
  created_at: "2026-11-23T00:00:00.000Z",
  updated_at: "2026-11-24T00:00:00.000Z",
};

interface MockOptions {
  role?: MembershipRole | null;
  organizationType?: OrganizationType | null;
  verificationStatus?: VerificationStatus | null;
  updateData?: CatalogOfferRow | null;
  updateError?: { code: string } | null;
}

class QueryBuilder {
  constructor(
    private readonly table: string,
    private readonly options: MockOptions,
    private readonly updates: unknown[],
    private readonly filters: { table: string; column: string; value: unknown }[],
  ) {}

  select() {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ table: this.table, column, value });
    return this;
  }

  update(values: unknown) {
    this.updates.push({ table: this.table, values });
    return this;
  }

  maybeSingle() {
    if (this.table === "organization_memberships") {
      return {
        data: this.options.role ? { role: this.options.role } : null,
        error: null,
      };
    }
    if (this.table === "organizations") {
      return {
        data: this.options.organizationType
          ? { organization_type: this.options.organizationType }
          : null,
        error: null,
      };
    }
    if (this.table === "supplier_profiles") {
      return {
        data: this.options.verificationStatus
          ? { verification_status: this.options.verificationStatus }
          : null,
        error: null,
      };
    }
    return { data: null, error: null };
  }

  single() {
    return {
      data:
        this.options.updateData === undefined ? updatedOffer : this.options.updateData,
      error: this.options.updateError ?? null,
    };
  }
}

function createClient(options: MockOptions = {}) {
  const updates: unknown[] = [];
  const filters: { table: string; column: string; value: unknown }[] = [];
  const client = {
    from: (table: string) => new QueryBuilder(table, options, updates, filters),
  } as unknown as WorkspaceClient;
  return { client, updates, filters };
}

const terms = {
  priceAmount: 17.25,
  currency: "KZT",
  availability: "low_stock" as const,
};

describe("supplier catalog edit access", () => {
  it("recognizes only the privileged catalog-management roles", () => {
    expect(canManageSupplierCatalog("owner")).toBe(true);
    expect(canManageSupplierCatalog("admin")).toBe(true);
    expect(canManageSupplierCatalog("catalog_operator")).toBe(true);
    expect(canManageSupplierCatalog("order_operator")).toBe(false);
    expect(canManageSupplierCatalog("viewer")).toBe(false);
  });

  it("persists only price, currency, and availability for an approved own-tenant offer", async () => {
    const { client, updates, filters } = createClient({
      role: "catalog_operator",
      organizationType: "supplier",
      verificationStatus: "approved",
    });

    await expect(
      updateCatalogOfferTerms(client, "supplier-1", "offer-1", terms),
    ).resolves.toEqual(updatedOffer);

    expect(updates).toEqual([
      {
        table: "catalog_offers",
        values: {
          price_amount: 17.25,
          currency: "KZT",
          availability: "low_stock",
        },
      },
    ]);
    expect(filters).toContainEqual({
      table: "catalog_offers",
      column: "id",
      value: "offer-1",
    });
    expect(filters).toContainEqual({
      table: "catalog_offers",
      column: "supplier_organization_id",
      value: "supplier-1",
    });
  });

  it("blocks an order-only member in the data layer before attempting the update", async () => {
    const { client, updates } = createClient({
      role: "order_operator",
      organizationType: "supplier",
      verificationStatus: "approved",
    });

    await expect(
      updateCatalogOfferTerms(client, "supplier-1", "offer-1", terms),
    ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "permission" });
    expect(updates).toEqual([]);
  });

  it("blocks a privileged member while the supplier profile is still pending", async () => {
    const { client, updates } = createClient({
      role: "catalog_operator",
      organizationType: "supplier",
      verificationStatus: "pending",
    });

    await expect(
      updateCatalogOfferTerms(client, "supplier-1", "offer-1", terms),
    ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "permission" });
    expect(updates).toEqual([]);
  });

  it("blocks an organization that is not a supplier", async () => {
    const { client, updates } = createClient({
      role: "catalog_operator",
      organizationType: "buyer",
      verificationStatus: "approved",
    });

    await expect(
      updateCatalogOfferTerms(client, "supplier-1", "offer-1", terms),
    ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "permission" });
    expect(updates).toEqual([]);
  });

  it("scopes the update to the selected supplier and maps an invisible foreign offer to not-found", async () => {
    const { client, filters } = createClient({
      role: "catalog_operator",
      organizationType: "supplier",
      verificationStatus: "approved",
      updateData: null,
      updateError: { code: "PGRST116" },
    });

    await expect(
      updateCatalogOfferTerms(client, "supplier-1", "offer-from-supplier-2", terms),
    ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "not_found" });
    expect(filters).toContainEqual({
      table: "catalog_offers",
      column: "supplier_organization_id",
      value: "supplier-1",
    });
  });
});

import {
  canManageOrganization,
  generateInvitationToken,
  invitationLink,
  listOrganizationMembers,
  listOrganizationInvitations,
  createOrganizationInvitation,
  revokeOrganizationInvitation,
  changeOrganizationMemberRole,
  removeOrganizationMember,
  acceptOrganizationInvitation,
} from "./workspace";

describe("organization access RPC contract", () => {
  it("gates organization management to owner and admin", () => {
    expect(canManageOrganization("owner")).toBe(true);
    expect(canManageOrganization("admin")).toBe(true);
    expect(canManageOrganization("buyer")).toBe(false);
    expect(canManageOrganization("viewer")).toBe(false);
  });

  it("generates a 43-character URL-safe cryptographic token and fragment link", () => {
    const token = generateInvitationToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invitationLink(token)).toBe(
      `${window.location.origin}/account#invite=${token}`,
    );
  });

  it("uses only the named RPCs for membership and invitation actions", async () => {
    const rpc = vi.fn((name: string) =>
      Promise.resolve({
        data: name.startsWith("list_")
          ? []
          : name === "create_organization_invitation"
            ? [{ invitation_id: "inv-1", expires_at: "soon" }]
            : name === "accept_organization_invitation"
              ? "org-1"
              : true,
        error: null,
      }),
    );
    const from = vi.fn(() => {
      throw new Error("table access is forbidden for this feature");
    });
    const client = { rpc, from } as unknown as WorkspaceClient;
    await listOrganizationMembers(client, "org");
    await listOrganizationInvitations(client, "org");
    await createOrganizationInvitation(
      client,
      "org",
      "test@example.invalid",
      "buyer",
      "secret",
    );
    await revokeOrganizationInvitation(client, "org", "inv");
    await changeOrganizationMemberRole(client, "org", "user", "viewer");
    await removeOrganizationMember(client, "org", "user");
    await acceptOrganizationInvitation(client, "secret");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "list_organization_members",
      "list_organization_invitations",
      "create_organization_invitation",
      "revoke_organization_invitation",
      "change_organization_member_role",
      "remove_organization_member",
      "accept_organization_invitation",
    ]);
    expect(from).not.toHaveBeenCalled();
  });

  it("treats empty invitation rows and false mutation results as failures", async () => {
    const rpc = vi.fn((name: string) =>
      Promise.resolve({
        data: name === "create_organization_invitation" ? [] : false,
        error: null,
      }),
    );
    const client = { rpc } as unknown as WorkspaceClient;

    await expect(
      createOrganizationInvitation(
        client,
        "org",
        "manager@example.invalid",
        "buyer",
        "A".repeat(43),
      ),
    ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "operation_failed" });
    await expect(
      revokeOrganizationInvitation(client, "org", "invitation"),
    ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "operation_failed" });
    await expect(
      changeOrganizationMemberRole(client, "org", "member", "viewer"),
    ).rejects.toMatchObject<Partial<WorkspaceError>>({ code: "operation_failed" });
    await expect(removeOrganizationMember(client, "org", "member")).rejects.toMatchObject<
      Partial<WorkspaceError>
    >({ code: "operation_failed" });
  });
});
