import { expect, test, type Page } from "@playwright/test";

const LOCAL_SUPABASE_URL = "http://127.0.0.1:4173";
const MOCK_PUBLISHABLE_KEY = "sb_publishable_playwright-test-key";
const usesLocalAuthMock =
  process.env.VITE_SUPABASE_URL === LOCAL_SUPABASE_URL &&
  (process.env.VITE_SUPABASE_PUBLISHABLE_KEY === MOCK_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY === MOCK_PUBLISHABLE_KEY);

const mockUser = {
  id: "00000000-0000-4000-8000-000000000022",
  aud: "authenticated",
  role: "authenticated",
  email: "e2e.management@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  email_confirmed_at: "2026-11-24T00:00:00.000Z",
};

const organizationId = "00000000-0000-4000-8000-000000000023";
const locationId = "00000000-0000-4000-8000-000000000024";
const now = "2026-11-24T00:00:00.000Z";
const supplierSuborderId = "00000000-0000-4000-8000-000000000025";
const supplierSuborderLineId = "00000000-0000-4000-8000-000000000026";
const syntheticSupplierSuborder = {
  supplier_suborder_id: supplierSuborderId,
  status: "awaiting_supplier",
  workflow_version: 1,
  current_terms_version: 1,
  terms_reason: "Synthetic current terms only",
  response_deadline_at: null,
  created_at: now,
  updated_at: now,
  lines: [
    {
      buyer_request_line_id: supplierSuborderLineId,
      title: "Synthetic flour",
      sell_unit_label: "bag",
      units_per_sell_unit: 1,
      pack_amount: "5.000",
      pack_base_unit: "kg",
      quantity: 4,
      price_amount: "18.2500",
      currency: "PLN",
    },
  ],
};

function mockSession() {
  return {
    access_token: "mock-management-access-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "mock-management-refresh-token",
    user: mockUser,
  };
}

async function mockAuth(page: Page): Promise<void> {
  await page.route(`${LOCAL_SUPABASE_URL}/auth/v1/**`, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/auth/v1/token")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-supabase-api-version": "2024-01-01" },
        body: JSON.stringify(mockSession()),
      });
      return;
    }
    if (pathname.endsWith("/auth/v1/user")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-supabase-api-version": "2024-01-01" },
        body: JSON.stringify(mockUser),
      });
      return;
    }
    await route.fulfill({
      status: 401,
      contentType: "application/json",
      headers: { "x-supabase-api-version": "2024-01-01" },
      body: JSON.stringify({
        code: "missing_authorization",
        message: "Missing authorization header",
      }),
    });
  });
}

async function mockWorkspace(
  page: Page,
  organizationType: "buyer" | "supplier",
  options: { readonly supplierSuborders?: readonly Record<string, unknown>[] } = {},
): Promise<{
  mutations: { method: string; table: string; payload: unknown }[];
  rpcCalls: { functionName: string; payload: Record<string, unknown> | null }[];
}> {
  const mutations: { method: string; table: string; payload: unknown }[] = [];
  const rpcCalls: { functionName: string; payload: Record<string, unknown> | null }[] =
    [];
  let supplierSuborders = [...(options.supplierSuborders ?? [])];
  let location = {
    id: locationId,
    organization_id: organizationId,
    name: "Warsaw kitchen",
    address: "Synthetic original address",
    delivery_zone: "Warsaw",
    created_at: now,
  };
  let displayName = "Fresh synthetic supplier";

  await page.route(`${LOCAL_SUPABASE_URL}/rest/v1/**`, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const table = pathname.split("/").at(-1);
    const method = request.method();
    const payload = request.postDataJSON() as Record<string, unknown> | null;
    let rows: unknown[] = [];
    let rpcResponse: unknown = [];

    if (pathname.includes("/rest/v1/rpc/") && method === "POST") {
      const functionName = table ?? "unknown";
      rpcCalls.push({ functionName, payload });
      if (functionName === "list_supplier_suborders") {
        rpcResponse =
          payload?.p_supplier_organization_id === organizationId ? supplierSuborders : [];
      } else if (functionName === "accept_supplier_suborder") {
        const requestedId = payload?.p_supplier_suborder_id;
        const current = supplierSuborders.find(
          (suborder) => suborder.supplier_suborder_id === requestedId,
        );
        if (
          payload?.p_supplier_organization_id !== organizationId ||
          !current ||
          !requestedId
        ) {
          await route.fulfill({
            status: 403,
            contentType: "application/json",
            body: JSON.stringify({ code: "42501", message: "Synthetic tenant boundary" }),
          });
          return;
        }
        const nextVersion = Number(current.workflow_version) + 1;
        const currentTermsVersion = Number(current.current_terms_version);
        supplierSuborders = supplierSuborders.map((suborder) =>
          suborder.supplier_suborder_id === requestedId
            ? {
                ...suborder,
                status: "supplier_accepted",
                workflow_version: nextVersion,
                updated_at: "2026-11-24T00:05:00.000Z",
              }
            : suborder,
        );
        rpcResponse = {
          supplier_suborder_id: requestedId,
          status: "supplier_accepted",
          workflow_version: nextVersion,
          current_terms_version: currentTermsVersion,
          event_id: "00000000-0000-4000-8000-000000000027",
          replayed: false,
        };
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-supabase-api-version": "2024-01-01" },
        body: JSON.stringify(rpcResponse),
      });
      return;
    }

    if (method === "GET") {
      if (table === "organizations") {
        rows = [
          {
            id: organizationId,
            name: "Synthetic E2E organization",
            organization_type: organizationType,
            created_by: mockUser.id,
            created_at: now,
          },
        ];
      } else if (table === "organization_memberships") {
        rows = [{ organization_id: organizationId, role: "owner" }];
      } else if (table === "buyer_locations" && organizationType === "buyer") {
        rows = [location];
      } else if (table === "supplier_profiles" && organizationType === "supplier") {
        rows = [
          {
            organization_id: organizationId,
            display_name: displayName,
            verification_status: "approved",
            created_at: now,
          },
        ];
      }
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: {
          "content-range": `0-${Math.max(0, rows.length - 1)}/${rows.length}`,
          "x-supabase-api-version": "2024-01-01",
        },
        body: JSON.stringify(rows),
      });
      return;
    }

    if (table === "buyer_locations" && method === "PATCH" && payload) {
      mutations.push({ method, table, payload });
      location = { ...location, ...payload };
      rows = [location];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-supabase-api-version": "2024-01-01" },
        body: JSON.stringify(rows),
      });
      return;
    }

    if (table === "supplier_profiles" && method === "PATCH" && payload) {
      mutations.push({ method, table, payload });
      displayName = String(payload.display_name);
      rows = [
        {
          organization_id: organizationId,
          display_name: displayName,
          verification_status: "approved",
          created_at: now,
        },
      ];
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        headers: { "x-supabase-api-version": "2024-01-01" },
        body: JSON.stringify(rows),
      });
      return;
    }

    if (table === "buyer_locations" && method === "DELETE") {
      mutations.push({ method, table, payload });
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (
      (table === "buyer_locations" || table === "supplier_profiles") &&
      (method === "POST" || method === "PATCH" || method === "DELETE")
    ) {
      mutations.push({ method, table: table ?? "unknown", payload });
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "x-supabase-api-version": "2024-01-01" },
      body: JSON.stringify(rows),
    });
  });
  return { mutations, rpcCalls };
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/account");
  await page.getByLabel("Email").fill(mockUser.email);
  await page.getByLabel("Пароль").fill("synthetic-e2e-password");
  await page.getByRole("button", { name: "Войти" }).last().click();
  await expect(page.getByRole("heading", { name: "Рабочее пространство" })).toBeVisible();
}

test("buyer can edit and delete a location through the account UI", async ({ page }) => {
  test.skip(!usesLocalAuthMock, "Runs only with the local mocked Supabase build.");
  await mockAuth(page);
  const { mutations, rpcCalls } = await mockWorkspace(page, "buyer");
  page.on("dialog", (dialog) => dialog.accept());
  await signIn(page);

  await expect(page.getByText("Synthetic original address")).toBeVisible();
  await page.getByRole("button", { name: "Изменить точку" }).click();
  await page.getByLabel("Название точки").fill("Renamed synthetic kitchen");
  await page.getByLabel("Адрес").fill("Synthetic updated address");
  await page.getByRole("button", { name: "Сохранить точку" }).click();
  await expect(page.getByText("Точка обновлена.")).toBeVisible();
  await expect(page.getByText("Synthetic updated address")).toBeVisible();

  await page.getByRole("button", { name: "Удалить точку" }).click();
  await expect(page.getByText("Точка удалена из этой организации.")).toBeVisible();
  expect(rpcCalls.some((call) => call.functionName === "list_supplier_suborders")).toBe(
    false,
  );
  expect(mutations).toEqual([
    {
      method: "PATCH",
      table: "buyer_locations",
      payload: {
        name: "Renamed synthetic kitchen",
        address: "Synthetic updated address",
        delivery_zone: "Warsaw",
      },
    },
    { method: "DELETE", table: "buyer_locations", payload: null },
  ]);
});

test("supplier owner can change only the display name through the account UI", async ({
  page,
}) => {
  test.skip(!usesLocalAuthMock, "Runs only with the local mocked Supabase build.");
  await mockAuth(page);
  const { mutations } = await mockWorkspace(page, "supplier");
  await signIn(page);

  await expect(page.getByText("Fresh synthetic supplier").first()).toBeVisible();
  await page.getByRole("button", { name: "Изменить название" }).click();
  await page.getByLabel("Название профиля").fill("Updated synthetic supplier");
  await page.getByRole("button", { name: "Сохранить название" }).click();
  await expect(page.getByText("Updated synthetic supplier").first()).toBeVisible();

  expect(mutations).toEqual([
    {
      method: "PATCH",
      table: "supplier_profiles",
      payload: { display_name: "Updated synthetic supplier" },
    },
  ]);
});

test("supplier owner sees and accepts only the synthetic API-backed inbox item", async ({
  page,
}) => {
  test.skip(!usesLocalAuthMock, "Runs only with the local mocked Supabase build.");
  await mockAuth(page);
  const { rpcCalls } = await mockWorkspace(page, "supplier", {
    supplierSuborders: [syntheticSupplierSuborder],
  });
  await signIn(page);

  await expect(
    page.getByRole("heading", { name: "Входящие подзаказы поставщика" }),
  ).toBeVisible();
  await expect(page.getByText(/текущее состояние по данным API/i)).toBeVisible();
  await expect(page.getByText(/не полный журнал решений/i)).toBeVisible();
  await expect(page.getByText("Synthetic flour")).toBeVisible();
  await page.getByRole("button", { name: "Принять условия" }).click();
  await expect(page.getByText(/Текущий статус: Поставщик принял условия/)).toBeVisible();

  const supplierCalls = rpcCalls.filter((call) =>
    ["list_supplier_suborders", "accept_supplier_suborder"].includes(call.functionName),
  );
  expect(supplierCalls.map((call) => call.functionName)).toEqual([
    "list_supplier_suborders",
    "accept_supplier_suborder",
    "list_supplier_suborders",
  ]);
  expect(supplierCalls[0]?.payload).toEqual({
    p_supplier_organization_id: organizationId,
  });
  expect(supplierCalls[1]?.payload).toMatchObject({
    p_supplier_organization_id: organizationId,
    p_supplier_suborder_id: supplierSuborderId,
    p_expected_version: 1,
  });
  expect(supplierCalls[1]?.payload?.p_idempotency_key).toMatch(
    /^[0-9a-f]{8}-[0-9a-f-]{27}$/i,
  );
});
