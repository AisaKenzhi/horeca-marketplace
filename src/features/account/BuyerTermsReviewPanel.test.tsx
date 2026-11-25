// @vitest-environment jsdom
import { createClient } from "@supabase/supabase-js";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database, MembershipRole } from "@/data/supabase/database.types";
import {
  SupplierSuborderClientError,
  type SupplierSuborderClientErrorCode,
} from "@/data/supabase/supplierSuborders";
import type {
  BuyerTermsAdapter,
  BuyerTermsDecision,
  BuyerTermsReceipt,
} from "@/data/supabase/buyerSuborderTerms";
import { loadBuyerProcurementRequests } from "@/data/supabase/workspace";
import type { SupplierSuborderWorkflow } from "@/domain/supplierSuborderWorkflow";
import { BuyerTermsReviewPanel } from "./BuyerTermsReviewPanel";

vi.mock("@/data/supabase/workspace", () => ({
  loadBuyerProcurementRequests: vi.fn(),
  workspaceErrorMessage: (error: unknown) =>
    error instanceof Error ? error.message : "Не удалось выполнить запрос.",
}));

const organizationId = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const suborderId = "33333333-3333-4333-8333-333333333333";
const lineId = "44444444-4444-4444-8444-444444444444";
const eventId = "55555555-5555-4555-8555-555555555555";
const now = "2026-11-25T09:00:00.000Z";
const client = createClient<Database>("http://buyer-ui.test", "local-publishable-key", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

const workflow: SupplierSuborderWorkflow = {
  supplierSuborderId: suborderId,
  status: "awaiting_buyer_decision",
  workflowVersion: 3,
  currentTermsVersion: 2,
  termsReason: "Synthetic proposed terms",
  responseDeadlineAt: "2026-11-27T09:00:00.000Z",
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
const receipt: BuyerTermsReceipt = {
  supplierSuborderId: suborderId,
  status: "buyer_accepted",
  workflowVersion: 4,
  currentTermsVersion: 2,
  eventId,
  replayed: false,
};

type Spies = {
  readonly list: ReturnType<typeof vi.fn<BuyerTermsAdapter["list"]>>;
  readonly accept: ReturnType<typeof vi.fn<BuyerTermsAdapter["accept"]>>;
  readonly reject: ReturnType<typeof vi.fn<BuyerTermsAdapter["reject"]>>;
};
function makeAdapter(errorCode?: SupplierSuborderClientErrorCode): {
  adapter: BuyerTermsAdapter;
  spies: Spies;
} {
  const spies: Spies = {
    list: vi.fn<BuyerTermsAdapter["list"]>().mockResolvedValue([workflow]),
    accept: vi.fn<BuyerTermsAdapter["accept"]>(),
    reject: vi.fn<BuyerTermsAdapter["reject"]>(),
  };
  if (errorCode) {
    spies.accept.mockImplementation(() =>
      Promise.reject(new SupplierSuborderClientError(errorCode)),
    );
  } else {
    spies.accept.mockResolvedValue(receipt);
  }
  spies.reject.mockResolvedValue({ ...receipt, status: "buyer_rejected" });
  const adapter: BuyerTermsAdapter = {
    list: (c, scope, request) => spies.list(c, scope, request),
    accept: (c, scope, decision) => spies.accept(c, scope, decision),
    reject: (c, scope, decision) => spies.reject(c, scope, decision),
  };
  return { adapter, spies };
}

function renderPanel(
  adapter: BuyerTermsAdapter,
  role: MembershipRole = "buyer",
  requests: readonly {
    id: string;
    source_list_name: string;
    request_status: string;
  }[] = [
    { id: requestId, source_list_name: "Synthetic list", request_status: "submitted" },
  ],
) {
  vi.mocked(loadBuyerProcurementRequests).mockResolvedValue(
    requests as Awaited<ReturnType<typeof loadBuyerProcurementRequests>>,
  );
  return render(
    <BuyerTermsReviewPanel
      client={client}
      organizationId={organizationId}
      organizationType="buyer"
      role={role}
      adapter={adapter}
    />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  cleanup();
});

describe("BuyerTermsReviewPanel", () => {
  it("shows an empty state when the buyer has no requests", async () => {
    const { adapter, spies } = makeAdapter();
    renderPanel(adapter, "buyer", []);
    expect(await screen.findByText("Запросов закупки пока нет.")).toBeInTheDocument();
    expect(spies.list).not.toHaveBeenCalled();
  });

  it("gives viewers read-only access without decision controls", async () => {
    const { adapter } = makeAdapter();
    renderPanel(adapter, "viewer");
    expect(
      await screen.findByText("Ваша роль доступна только для чтения."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Принять условия/ }),
    ).not.toBeInTheDocument();
  });

  it("shows exact proposal terms and accepts only the current termsVersion", async () => {
    const user = userEvent.setup();
    const { adapter, spies } = makeAdapter();
    renderPanel(adapter);

    const card = await screen.findByRole("article", {
      name: /Ветка поставщика/,
    });
    expect(within(card).getByText("Synthetic proposed terms")).toBeInTheDocument();
    expect(within(card).getByText(/18\.2500 KZT/)).toBeInTheDocument();
    expect(within(card).getByText(/Ожидает решения покупателя/)).toBeInTheDocument();

    await user.click(within(card).getByRole("button", { name: "Принять условия v2" }));
    const decision = spies.accept.mock.calls[0]?.[2];
    expect(decision?.termsVersion).toBe(2);
    expect(decision?.workflow).toEqual(workflow);
    expect(decision?.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/i);
    expect(await screen.findByText(/Решение записано/)).toHaveTextContent(
      "не подтверждённая закупка, оплата, резерв или доставка",
    );
  });

  it("requires an explicit reason to reject and passes it to the RPC", async () => {
    const user = userEvent.setup();
    const { adapter, spies } = makeAdapter();
    renderPanel(adapter);
    const card = await screen.findByRole("article", { name: /Ветка поставщика/ });
    const rejectButton = within(card).getByRole("button", {
      name: "Отклонить с причиной",
    });
    expect(rejectButton).toBeDisabled();
    await user.type(
      within(card).getByLabelText("Причина отклонения"),
      "Synthetic rejection reason",
    );
    expect(rejectButton).toBeEnabled();
    await user.click(rejectButton);
    expect((spies.reject.mock.calls[0]?.[2] as BuyerTermsDecision).reason).toBe(
      "Synthetic rejection reason",
    );
  });

  it("keeps a safe state and offers refresh on a version conflict", async () => {
    const user = userEvent.setup();
    const { adapter } = makeAdapter("version_conflict");
    renderPanel(adapter);
    const card = await screen.findByRole("article", { name: /Ветка поставщика/ });
    await user.click(within(card).getByRole("button", { name: "Принять условия v2" }));
    expect(
      await screen.findByText("Условия изменились или версия устарела."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Обновить список" })).toBeInTheDocument();
    expect(screen.queryByText(/Решение записано/)).not.toBeInTheDocument();
  });
});
