// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BuyerProcurementListItemRow,
  BuyerProcurementListRow,
  CatalogOfferRow,
  MembershipRole,
  SupplierProfileRow,
} from "@/data/supabase/database.types";
import type { WorkspaceClient } from "@/data/supabase/workspace";
import {
  addBuyerProcurementListItem,
  createBuyerProcurementList,
  deleteBuyerProcurementList,
  loadBuyerProcurementLists,
  removeBuyerProcurementListItem,
  renameBuyerProcurementList,
  updateBuyerProcurementListItemQuantity,
} from "@/data/supabase/workspace";
import { BuyerProcurementListsPanel } from "./BuyerProcurementListsPanel";

vi.mock("@/data/supabase/workspace", () => ({
  addBuyerProcurementListItem: vi.fn(),
  canManageBuyerProcurement: (role: MembershipRole) =>
    role === "owner" || role === "admin" || role === "buyer",
  canReadBuyerProcurement: (role: MembershipRole) =>
    role === "owner" || role === "admin" || role === "buyer" || role === "viewer",
  createBuyerProcurementList: vi.fn(),
  deleteBuyerProcurementList: vi.fn(),
  loadBuyerProcurementLists: vi.fn(),
  removeBuyerProcurementListItem: vi.fn(),
  renameBuyerProcurementList: vi.fn(),
  updateBuyerProcurementListItemQuantity: vi.fn(),
  workspaceErrorMessage: () => "Не удалось выполнить запрос.",
}));

const organizationId = "buyer-org-1";
const listId = "list-1";
const itemId = "item-1";
const offerId = "offer-1";
const now = "2026-11-24T00:00:00.000Z";

const listItem: BuyerProcurementListItemRow = {
  id: itemId,
  organization_id: organizationId,
  list_id: listId,
  catalog_offer_id: offerId,
  quantity: 2,
  created_at: now,
  updated_at: now,
};

const list: BuyerProcurementListRow & { items: BuyerProcurementListItemRow[] } = {
  id: listId,
  organization_id: organizationId,
  name: "Weekly order",
  created_by: "user-1",
  created_at: now,
  updated_at: now,
  items: [listItem],
};

const offers: CatalogOfferRow[] = [
  {
    id: offerId,
    supplier_organization_id: "supplier-org-1",
    supplier_sku: "FLOUR-1",
    title: "Flour",
    category: "Grocery",
    sell_unit_label: "bag",
    units_per_sell_unit: 1,
    pack_amount: 5,
    pack_base_unit: "kg",
    price_amount: null,
    currency: null,
    moq: 1,
    order_step: 1,
    availability: "unknown",
    price_valid_until: null,
    is_published: true,
    price_observed_at: now,
    availability_observed_at: now,
    version: 1,
    created_at: now,
    updated_at: now,
  },
  {
    id: "offer-2",
    supplier_organization_id: "supplier-org-1",
    supplier_sku: "OIL-1",
    title: "Oil",
    category: "Grocery",
    sell_unit_label: "bottle",
    units_per_sell_unit: 1,
    pack_amount: 1,
    pack_base_unit: "l",
    price_amount: null,
    currency: null,
    moq: 1,
    order_step: 1,
    availability: "unknown",
    price_valid_until: null,
    is_published: true,
    price_observed_at: now,
    availability_observed_at: now,
    version: 1,
    created_at: now,
    updated_at: now,
  },
];

const supplierProfiles: SupplierProfileRow[] = [
  {
    organization_id: "supplier-org-1",
    display_name: "Supplier One",
    verification_status: "approved",
    created_at: now,
  },
];
const client = {} as WorkspaceClient;

function renderPanel(role: MembershipRole = "buyer") {
  return render(
    <BuyerProcurementListsPanel
      client={client}
      organizationId={organizationId}
      role={role}
      offers={offers}
      supplierProfiles={supplierProfiles}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadBuyerProcurementLists).mockResolvedValue([list]);
  vi.mocked(createBuyerProcurementList).mockResolvedValue(list);
  vi.mocked(renameBuyerProcurementList).mockResolvedValue(list);
  vi.mocked(deleteBuyerProcurementList).mockResolvedValue();
  vi.mocked(addBuyerProcurementListItem).mockResolvedValue(listItem);
  vi.mocked(updateBuyerProcurementListItemQuantity).mockResolvedValue(listItem);
  vi.mocked(removeBuyerProcurementListItem).mockResolvedValue();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BuyerProcurementListsPanel", () => {
  it("lets a buyer manage persistent lists and their items", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("heading", { name: "Weekly order", level: 3 });

    await user.type(screen.getByLabelText("Новый список"), "Monthly order");
    await user.click(screen.getByRole("button", { name: "Создать список" }));
    expect(createBuyerProcurementList).toHaveBeenCalledWith(
      client,
      organizationId,
      "buyer",
      "Monthly order",
    );

    await user.click(screen.getByRole("button", { name: "Переименовать" }));
    const renameInput = screen.getByLabelText("Название списка");
    await user.clear(renameInput);
    await user.type(renameInput, "Weekly pantry");
    await user.click(screen.getByRole("button", { name: "Сохранить название" }));
    expect(renameBuyerProcurementList).toHaveBeenCalledWith(
      client,
      organizationId,
      "buyer",
      listId,
      "Weekly pantry",
    );

    const quantityInput = screen.getByLabelText("Количество (продаваемые единицы)");
    await user.clear(quantityInput);
    await user.type(quantityInput, "5");
    await user.click(screen.getByRole("button", { name: "Сохранить количество" }));
    expect(updateBuyerProcurementListItemQuantity).toHaveBeenCalledWith(
      client,
      organizationId,
      "buyer",
      itemId,
      5,
    );

    await user.selectOptions(
      screen.getByLabelText("Добавить опубликованное предложение"),
      "offer-2",
    );
    await user.clear(screen.getByLabelText("Количество", { exact: true }));
    await user.type(screen.getByLabelText("Количество", { exact: true }), "4");
    await user.click(screen.getByRole("button", { name: "Добавить предложение" }));
    expect(addBuyerProcurementListItem).toHaveBeenCalledWith(
      client,
      organizationId,
      "buyer",
      listId,
      "offer-2",
      4,
    );

    await user.click(screen.getByRole("button", { name: "Удалить позицию" }));
    expect(removeBuyerProcurementListItem).toHaveBeenCalledWith(
      client,
      organizationId,
      "buyer",
      itemId,
    );

    vi.spyOn(window, "confirm").mockReturnValue(true);
    await user.click(screen.getByRole("button", { name: "Удалить список" }));
    expect(deleteBuyerProcurementList).toHaveBeenCalledWith(
      client,
      organizationId,
      "buyer",
      listId,
    );
  });

  it("creates a visible, separate draft cart without invoking order or persistence APIs", async () => {
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole("heading", { name: "Weekly order", level: 3 });

    await user.click(
      screen.getByRole("button", {
        name: "Добавить список в новую черновую корзину",
      }),
    );

    expect(
      screen.getByRole("heading", { name: /Черновая корзина 1/ }),
    ).toBeInTheDocument();
    expect(screen.getAllByText("Flour")).toHaveLength(2);
    expect(screen.getByText(/количество: 2/)).toBeInTheDocument();
    expect(screen.getByText(/Заказы не создаются/)).toBeInTheDocument();
    expect(createBuyerProcurementList).not.toHaveBeenCalled();
    expect(addBuyerProcurementListItem).not.toHaveBeenCalled();
    expect(updateBuyerProcurementListItemQuantity).not.toHaveBeenCalled();
    expect(deleteBuyerProcurementList).not.toHaveBeenCalled();
  });

  it("keeps viewer access read-only and hides draft-cart creation", async () => {
    renderPanel("viewer");
    await screen.findByRole("heading", { name: "Weekly order", level: 3 });

    expect(screen.getByText("2", { selector: "strong" })).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Количество (продаваемые единицы)"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Переименовать" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Удалить список" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Удалить позицию" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Добавить предложение" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "Добавить список в новую черновую корзину",
      }),
    ).not.toBeInTheDocument();
    expect(createBuyerProcurementList).not.toHaveBeenCalled();
    expect(updateBuyerProcurementListItemQuantity).not.toHaveBeenCalled();
  });
});
