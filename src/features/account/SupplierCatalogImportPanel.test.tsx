// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import userEvent from "@testing-library/user-event";
import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, MembershipRole } from "@/data/supabase/database.types";
import type { WorkspaceClient } from "@/data/supabase/workspace";
import { SupplierCatalogImportPanel } from "./SupplierCatalogImportPanel";

const workspaceMocks = vi.hoisted(() => ({
  preview: vi.fn(),
  apply: vi.fn(),
}));

vi.mock("@/data/supabase/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data/supabase/workspace")>();
  return {
    ...actual,
    previewSupplierCatalogImport: workspaceMocks.preview,
    applySupplierCatalogImport: workspaceMocks.apply,
  };
});

const organizationId = "supplier-tenant-1";
const key = "50000000-0000-4000-8000-000000000001";
const importId = "50000000-0000-4000-8000-000000000002";
const csvHeaders = [
  "vendor_sku",
  "title",
  "category",
  "sell_unit_label",
  "units_per_sell_unit",
  "pack_amount",
  "pack_base_unit",
  "price_amount",
  "currency",
  "moq",
  "order_step",
  "availability",
];
const validRow = [
  "SKU-1",
  "Flour",
  "Dry goods",
  "bag",
  "1",
  "5",
  "kg",
  "12.50",
  "EUR",
  "1",
  "1",
  "in_stock",
];

const preview = {
  import_id: importId,
  status: "previewed" as const,
  summary: { added: 1, updated: 0, unchanged: 0, errors: 0 },
  rows: [
    {
      row_number: 2,
      sku: "SKU-1",
      status: "added" as const,
      errors: [],
      changes: ["Новая позиция"],
      expected_version: null,
    },
  ],
};

const client: WorkspaceClient = createClient<Database>(
  "http://127.0.0.1:54321",
  "test-publishable-key",
);

function uploadCsv(contents: string, name = "supplier.csv") {
  const file = new File([contents], name, { type: "text/csv" });
  Object.defineProperty(file, "text", { value: () => Promise.resolve(contents) });
  fireEvent.change(screen.getByLabelText("CSV-файл"), {
    target: { files: [file] },
  });
}

function renderPanel(
  role: MembershipRole = "catalog_operator",
  verificationStatus: "pending" | "approved" | "rejected" = "approved",
) {
  return render(
    <SupplierCatalogImportPanel
      client={client}
      organizationId={organizationId}
      role={role}
      verificationStatus={verificationStatus}
      onApplied={vi.fn()}
    />,
  );
}

beforeEach(() => {
  workspaceMocks.preview.mockReset();
  workspaceMocks.apply.mockReset();
  workspaceMocks.preview.mockResolvedValue(preview);
  workspaceMocks.apply.mockResolvedValue({
    import_id: importId,
    status: "applied",
    summary: preview.summary,
  });
  vi.stubGlobal("crypto", {
    ...globalThis.crypto,
    randomUUID: () => key,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("supplier catalog import panel", () => {
  it("lets a supplier map a non-standard SKU column, previews rows and applies the whole batch", async () => {
    const user = userEvent.setup();
    const onApplied = vi.fn();
    render(
      <SupplierCatalogImportPanel
        client={client}
        organizationId={organizationId}
        role="catalog_operator"
        verificationStatus="approved"
        onApplied={onApplied}
      />,
    );

    uploadCsv([csvHeaders.join(","), validRow.join(",")].join("\n"));
    const skuMapping = await screen.findByLabelText("SKU поставщика (обязательно)");
    await user.selectOptions(skuMapping, "0");
    await user.click(screen.getByRole("button", { name: "Предпросмотр импорта" }));

    await screen.findByRole("heading", { name: "Предпросмотр" });
    expect(workspaceMocks.preview).toHaveBeenCalledWith(client, organizationId, key, [
      {
        row_number: 2,
        values: {
          sku: "SKU-1",
          title: "Flour",
          category: "Dry goods",
          sell_unit_label: "bag",
          units_per_sell_unit: "1",
          pack_amount: "5",
          pack_base_unit: "kg",
          price_amount: "12.50",
          currency: "EUR",
          moq: "1",
          order_step: "1",
          availability: "in_stock",
        },
        client_errors: [],
      },
    ]);
    expect(screen.getByText(/1 добавлено/)).toBeInTheDocument();
    const applyButton = screen.getByRole("button", { name: "Применить весь импорт" });
    expect(applyButton).toBeEnabled();
    await user.click(applyButton);
    await waitFor(() =>
      expect(workspaceMocks.apply).toHaveBeenCalledWith(client, organizationId, importId),
    );
    expect(onApplied).toHaveBeenCalledOnce();
    expect(screen.getByText("Импорт применён. Каталог обновлён.")).toBeInTheDocument();
  });

  it("shows server validation details and prevents any apply when one row blocks the batch", async () => {
    const user = userEvent.setup();
    workspaceMocks.preview.mockResolvedValue({
      import_id: importId,
      status: "blocked",
      summary: { added: 0, updated: 0, unchanged: 0, errors: 1 },
      rows: [
        {
          row_number: 2,
          sku: "SKU-1",
          status: "error",
          errors: ["invalid_price", "invalid_currency"],
          changes: [],
          expected_version: null,
        },
      ],
    });
    renderPanel();
    uploadCsv(
      [
        csvHeaders.join(","),
        [...validRow.slice(0, 7), "", "", ...validRow.slice(9)].join(","),
      ].join("\n"),
    );
    await user.selectOptions(
      await screen.findByLabelText("SKU поставщика (обязательно)"),
      "0",
    );

    await user.click(await screen.findByRole("button", { name: "Предпросмотр импорта" }));
    expect(
      await screen.findByText(
        "Есть блокирующие ошибки: пакет не будет применён частично.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Укажите положительную цену с точностью до 4 знаков."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Применить весь импорт" })).toBeDisabled();
    expect(workspaceMocks.apply).not.toHaveBeenCalled();
  });

  it("explains pending approval and hides the import panel from order-only roles", () => {
    const { rerender } = renderPanel("owner", "pending");
    expect(screen.getByText(/Профиль ещё на проверке/)).toBeInTheDocument();
    rerender(
      <SupplierCatalogImportPanel
        client={client}
        organizationId={organizationId}
        role="order_operator"
        verificationStatus="approved"
        onApplied={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("heading", { name: "Импорт каталога из CSV" }),
    ).not.toBeInTheDocument();
  });
});
