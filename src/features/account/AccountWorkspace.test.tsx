// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import type { User } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BuyerLocationRow,
  MembershipRole,
  OrganizationType,
  SupplierProfileRow,
} from "@/data/supabase/database.types";
import type { WorkspaceClient, WorkspaceSnapshot } from "@/data/supabase/workspace";
import {
  deleteBuyerLocation,
  loadWorkspace,
  updateBuyerLocation,
  updateSupplierProfileDisplayName,
} from "@/data/supabase/workspace";
import { AccountWorkspaceReady } from "./AccountWorkspace";

vi.mock("@/data/supabase/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/supabase/workspace")>();
  return {
    ...actual,
    deleteBuyerLocation: vi.fn(),
    loadWorkspace: vi.fn(),
    updateBuyerLocation: vi.fn(),
    updateSupplierProfileDisplayName: vi.fn(),
  };
});

const client = {} as WorkspaceClient;
const user = { id: "user-1", email: "owner@example.test" } as User;
const organizationId = "organization-1";
const createdAt = "2026-11-24T00:00:00.000Z";
const location: BuyerLocationRow = {
  id: "location-1",
  organization_id: organizationId,
  name: "Warsaw kitchen",
  address: "Synthetic old address",
  delivery_zone: "Warsaw",
  created_at: createdAt,
};
const supplierProfile: SupplierProfileRow = {
  organization_id: organizationId,
  display_name: "Fresh supplier",
  verification_status: "approved",
  created_at: createdAt,
};

function workspaceSnapshot(
  organizationType: OrganizationType,
  role: MembershipRole,
): WorkspaceSnapshot {
  return {
    organizations: [
      {
        id: organizationId,
        name: "Synthetic organization",
        organization_type: organizationType,
        created_by: user.id,
        created_at: createdAt,
        role,
      },
    ],
    locations: organizationType === "buyer" ? [location] : [],
    supplierProfiles: organizationType === "supplier" ? [supplierProfile] : [],
    offers: [],
    catalog: [],
  };
}

function renderWorkspace(organizationType: OrganizationType, role: MembershipRole) {
  vi.mocked(loadWorkspace).mockResolvedValue(workspaceSnapshot(organizationType, role));
  return render(<AccountWorkspaceReady client={client} user={user} inviteToken={null} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(updateBuyerLocation).mockResolvedValue(location);
  vi.mocked(deleteBuyerLocation).mockResolvedValue();
  vi.mocked(updateSupplierProfileDisplayName).mockResolvedValue(supplierProfile);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AccountWorkspaceReady management controls", () => {
  it("edits a buyer location through keyboard-accessible controls", async () => {
    const userInput = userEvent.setup();
    renderWorkspace("buyer", "owner");

    const editButton = await screen.findByRole("button", { name: "Изменить точку" });
    editButton.focus();
    await userInput.keyboard("{Enter}");

    const name = await screen.findByRole("textbox", { name: "Название точки" });
    await userInput.clear(name);
    await userInput.type(name, "Renamed synthetic kitchen");
    const address = screen.getByRole("textbox", { name: "Адрес" });
    await userInput.clear(address);
    await userInput.type(address, "Synthetic updated address");
    const save = screen.getByRole("button", { name: "Сохранить точку" });
    save.focus();
    await userInput.keyboard("{Enter}");

    expect(updateBuyerLocation).toHaveBeenCalledWith(
      client,
      organizationId,
      location.id,
      {
        name: "Renamed synthetic kitchen",
        address: "Synthetic updated address",
        deliveryZone: "Warsaw",
      },
    );
  });

  it("requires and honors keyboard-triggered confirmation before deleting a buyer location", async () => {
    const userInput = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWorkspace("buyer", "admin");

    const deleteButton = await screen.findByRole("button", { name: "Удалить точку" });
    deleteButton.focus();
    await userInput.keyboard("{Enter}");

    expect(confirm).toHaveBeenCalledWith(
      "Удалить точку «Warsaw kitchen»? Если она указана в сохранённой корзине или запросе, удаление будет отклонено.",
    );
    expect(deleteBuyerLocation).toHaveBeenCalledWith(client, organizationId, location.id);
  });

  it("lets a supplier owner change only the profile display name using the keyboard", async () => {
    const userInput = userEvent.setup();
    renderWorkspace("supplier", "owner");

    const editButton = await screen.findByRole("button", {
      name: "Изменить название",
    });
    editButton.focus();
    await userInput.keyboard("{Enter}");

    const name = await screen.findByRole("textbox", { name: "Название профиля" });
    await userInput.clear(name);
    await userInput.type(name, "Fresh synthetic supplier");
    const save = screen.getByRole("button", { name: "Сохранить название" });
    save.focus();
    await userInput.keyboard("{Enter}");

    expect(updateSupplierProfileDisplayName).toHaveBeenCalledWith(
      client,
      organizationId,
      "Fresh synthetic supplier",
    );
  });

  it("hides buyer location mutation controls from a viewer", async () => {
    renderWorkspace("buyer", "viewer");
    await screen.findByText("Synthetic old address");

    expect(
      screen.queryByRole("button", { name: "Изменить точку" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Удалить точку" }),
    ).not.toBeInTheDocument();
    expect(updateBuyerLocation).not.toHaveBeenCalled();
    expect(deleteBuyerLocation).not.toHaveBeenCalled();
  });

  it("hides supplier display-name mutation controls from an order operator", async () => {
    renderWorkspace("supplier", "order_operator");
    await screen.findByText("Fresh supplier");

    expect(
      screen.queryByRole("button", { name: "Изменить название" }),
    ).not.toBeInTheDocument();
    expect(updateSupplierProfileDisplayName).not.toHaveBeenCalled();
  });
});
