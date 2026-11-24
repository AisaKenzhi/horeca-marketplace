// @vitest-environment jsdom
import { createClient } from "@supabase/supabase-js";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MembershipRole, Database } from "@/data/supabase/database.types";
import type { SupplierSuborderInboxAdapter } from "@/data/supabase/supplierSuborderInboxAdapter";
import type { SupplierSuborderWorkflow } from "@/domain/supplierSuborderWorkflow";
import {
  SupplierSuborderClientError,
  type SupplierSuborderClientErrorCode,
} from "@/data/supabase/supplierSuborders";
import { SupplierSuborderInboxPanel } from "./SupplierSuborderInboxPanel";

const organizationId = "11111111-1111-4111-8111-111111111111";
const suborderId = "22222222-2222-4222-8222-222222222222";
const lineId = "33333333-3333-4333-8333-333333333333";
const eventId = "55555555-5555-4555-8555-555555555555";
const now = "2026-11-24T09:00:00.000Z";
const workflow: SupplierSuborderWorkflow = {
  supplierSuborderId: suborderId,
  status: "awaiting_supplier",
  workflowVersion: 1,
  currentTermsVersion: 1,
  termsReason: null,
  responseDeadlineAt: null,
  createdAt: now,
  updatedAt: now,
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
const acceptedWorkflow: SupplierSuborderWorkflow = {
  ...workflow,
  status: "supplier_accepted",
  workflowVersion: 2,
  updatedAt: "2026-11-24T09:05:00.000Z",
};
const acceptedReceipt = {
  supplierSuborderId: suborderId,
  status: "supplier_accepted" as const,
  workflowVersion: 2,
  currentTermsVersion: 1,
  eventId,
  replayed: false,
};
const inboxClient = createClient<Database>(
  "http://supplier-ui.test",
  "local-publishable-key",
  { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } },
);

type AdapterSpies = {
  readonly list: ReturnType<typeof vi.fn<SupplierSuborderInboxAdapter["list"]>>;
  readonly accept: ReturnType<typeof vi.fn<SupplierSuborderInboxAdapter["accept"]>>;
  readonly reject: ReturnType<typeof vi.fn<SupplierSuborderInboxAdapter["reject"]>>;
  readonly propose: ReturnType<typeof vi.fn<SupplierSuborderInboxAdapter["propose"]>>;
};
function makeAdapter(): {
  readonly adapter: SupplierSuborderInboxAdapter;
  readonly spies: AdapterSpies;
} {
  const spies: AdapterSpies = {
    list: vi.fn<SupplierSuborderInboxAdapter["list"]>(),
    accept: vi.fn<SupplierSuborderInboxAdapter["accept"]>(),
    reject: vi.fn<SupplierSuborderInboxAdapter["reject"]>(),
    propose: vi.fn<SupplierSuborderInboxAdapter["propose"]>(),
  };
  const adapter: SupplierSuborderInboxAdapter = {
    list: (client, scope) => spies.list(client, scope),
    accept: (client, scope, suborder, key) => spies.accept(client, scope, suborder, key),
    reject: (client, scope, suborder, reason, key) =>
      spies.reject(client, scope, suborder, reason, key),
    propose: (client, scope, suborder, reason, deadline, lines, key) =>
      spies.propose(client, scope, suborder, reason, deadline, lines, key),
  };
  return { adapter, spies };
}

function renderInbox(
  adapter: SupplierSuborderInboxAdapter,
  options: {
    readonly role?: MembershipRole;
    readonly organizationType?: "supplier" | "buyer";
  } = {},
) {
  return render(
    <SupplierSuborderInboxPanel
      client={inboxClient}
      organizationId={organizationId}
      organizationType={options.organizationType ?? "supplier"}
      role={options.role ?? "order_operator"}
      adapter={adapter}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SupplierSuborderInboxPanel", () => {
  it("shows loading while the own-tenant inbox request is pending", async () => {
    let finish: ((rows: readonly SupplierSuborderWorkflow[]) => void) | undefined;
    const { adapter, spies } = makeAdapter();
    spies.list.mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    renderInbox(adapter);

    expect(screen.getByRole("status")).toHaveTextContent(
      "Загружаем собственные подзаказы…",
    );
    finish?.([workflow]);
    expect(
      await screen.findByRole("button", { name: /Подзаказ · 22222222/ }),
    ).toBeInTheDocument();
    expect(spies.list).toHaveBeenCalledWith(inboxClient, {
      organizationId,
      organizationType: "supplier",
      role: "order_operator",
    });
  });

  it("shows the empty state without rendering another tenant's details", async () => {
    const { adapter, spies } = makeAdapter();
    spies.list.mockResolvedValue([]);
    renderInbox(adapter);
    expect(
      await screen.findByText("Собственных входящих подзаказов пока нет."),
    ).toBeInTheDocument();
    expect(screen.queryByText(/buyer|address|Warehouse/i)).not.toBeInTheDocument();
  });

  it("shows a safe load error and lets the supplier refresh", async () => {
    const user = userEvent.setup();
    const { adapter, spies } = makeAdapter();
    spies.list
      .mockRejectedValueOnce(new SupplierSuborderClientError("operation_failed"))
      .mockResolvedValueOnce([workflow]);
    renderInbox(adapter);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось выполнить действие",
    );
    await user.click(screen.getByRole("button", { name: "Обновить список" }));
    expect(
      await screen.findByRole("button", { name: /Подзаказ · 22222222/ }),
    ).toBeInTheDocument();
    expect(spies.list).toHaveBeenCalledTimes(2);
  });

  it("does not call the adapter for buyer organizations or non-order supplier roles", () => {
    const { adapter: buyerAdapter, spies: buyerSpies } = makeAdapter();
    renderInbox(buyerAdapter, { organizationType: "buyer", role: "owner" });
    expect(screen.getByRole("note")).toHaveTextContent("только организации-поставщику");
    expect(buyerSpies.list).not.toHaveBeenCalled();
    cleanup();

    const { adapter: catalogAdapter, spies: catalogSpies } = makeAdapter();
    renderInbox(catalogAdapter, { role: "catalog_operator" });
    expect(screen.getByRole("note")).toHaveTextContent(
      "ролью owner, admin или order_operator",
    );
    expect(catalogSpies.list).not.toHaveBeenCalled();
  });

  it("accepts an own suborder, then reloads and shows its new status", async () => {
    const user = userEvent.setup();
    const { adapter, spies } = makeAdapter();
    spies.list
      .mockResolvedValueOnce([workflow])
      .mockResolvedValueOnce([acceptedWorkflow]);
    spies.accept.mockResolvedValue(acceptedReceipt);
    renderInbox(adapter);

    await user.click(await screen.findByRole("button", { name: "Принять условия" }));
    await waitFor(() => expect(spies.accept).toHaveBeenCalledTimes(1));
    const [client, scope, passedWorkflow, key] = spies.accept.mock.calls[0]!;
    expect(client).toBe(inboxClient);
    expect(scope).toEqual({
      organizationId,
      organizationType: "supplier",
      role: "order_operator",
    });
    expect(passedWorkflow).toEqual(workflow);
    expect(key).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    expect(
      await screen.findByText(/Текущий статус: Поставщик принял условия/),
    ).toBeInTheDocument();
    expect(spies.list).toHaveBeenCalledTimes(2);
  });

  it("submits the supplier's rejection reason", async () => {
    const user = userEvent.setup();
    const { adapter, spies } = makeAdapter();
    spies.list
      .mockResolvedValueOnce([workflow])
      .mockResolvedValueOnce([
        { ...workflow, status: "supplier_rejected", workflowVersion: 2 },
      ]);
    spies.reject.mockResolvedValue({ ...acceptedReceipt, status: "supplier_rejected" });
    renderInbox(adapter);

    await user.click(await screen.findByRole("button", { name: "Отклонить с причиной" }));
    await user.type(screen.getByLabelText("Причина отклонения"), "Нет в наличии в демо");
    await user.click(screen.getByRole("button", { name: "Отправить отказ" }));
    await waitFor(() => expect(spies.reject).toHaveBeenCalledTimes(1));
    expect(spies.reject.mock.calls[0]?.[3]).toBe("Нет в наличии в демо");
    expect(
      await screen.findByText(/Текущий статус: Поставщик отклонил условия/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Предложить новую версию" }),
    ).not.toBeInTheDocument();
  });

  it("submits a complete changed supplier proposal with a future deadline", async () => {
    const user = userEvent.setup();
    const { adapter, spies } = makeAdapter();
    spies.list.mockResolvedValueOnce([workflow]).mockResolvedValueOnce([
      {
        ...workflow,
        status: "awaiting_buyer_decision",
        workflowVersion: 2,
        currentTermsVersion: 2,
      },
    ]);
    spies.propose.mockResolvedValue({
      ...acceptedReceipt,
      status: "awaiting_buyer_decision",
      currentTermsVersion: 2,
    });
    renderInbox(adapter);

    await user.click(
      await screen.findByRole("button", { name: "Предложить новую версию" }),
    );
    await user.type(
      screen.getByLabelText("Почему предлагаются новые условия"),
      "Обновилась цена",
    );
    const deadline = new Date(Date.now() + 86_400_000).toISOString().slice(0, 16);
    fireEvent.change(screen.getByLabelText("Срок ответа покупателя"), {
      target: { value: deadline },
    });
    await user.clear(screen.getByLabelText("Цена (KZT)"));
    await user.type(screen.getByLabelText("Цена (KZT)"), "19.25");
    await user.click(screen.getByRole("button", { name: "Передать новую версию" }));
    await waitFor(() => expect(spies.propose).toHaveBeenCalledTimes(1));
    const proposal = spies.propose.mock.calls[0]!;
    expect(proposal[3]).toBe("Обновилась цена");
    expect(proposal[4]).toMatch(/Z$/);
    expect(proposal[5]).toEqual([
      { buyerRequestLineId: lineId, quantity: 4, priceAmount: "19.25" },
    ]);
    expect(proposal[6]).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/i);
    expect(
      await screen.findByText(/Текущий статус: Ожидает решения покупателя/),
    ).toBeInTheDocument();
  });

  it("marks version conflicts stale and disables further decisions until refreshed", async () => {
    const user = userEvent.setup();
    const { adapter, spies } = makeAdapter();
    spies.list.mockResolvedValue([workflow]);
    spies.accept.mockRejectedValue(new SupplierSuborderClientError("version_conflict"));
    renderInbox(adapter);

    await user.click(await screen.findByRole("button", { name: "Принять условия" }));
    expect(
      await screen.findByText(/Показанные данные могли устареть/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Принять условия" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Обновить список" })).toBeEnabled();
  });

  it.each(["forbidden", "not_found", "operation_failed"] as const)(
    "presents %s failures without leaking server diagnostics",
    async (code: SupplierSuborderClientErrorCode) => {
      const { adapter, spies } = makeAdapter();
      spies.list.mockRejectedValue(new SupplierSuborderClientError(code));
      renderInbox(adapter);
      const alert = await screen.findByRole("alert");
      expect(alert.textContent).not.toContain("SQL");
      expect(alert.textContent).not.toContain("private");
    },
  );
});
