import { expect, test, type Page, type Route } from "@playwright/test";

const LOCAL_SUPABASE_URL = "http://127.0.0.1:4173";
const MOCK_PUBLISHABLE_KEY = "sb_publishable_playwright-test-key";
const usesLocalAuthMock =
  process.env.VITE_SUPABASE_URL === LOCAL_SUPABASE_URL &&
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY === MOCK_PUBLISHABLE_KEY;
const USER_ID = "00000000-0000-4000-8000-000000000201";
const SUPPLIER_ID = "00000000-0000-4000-8000-000000000202";
const SUBORDER_ID = "00000000-0000-4000-8000-000000000203";
const LINE_ID = "00000000-0000-4000-8000-000000000204";
const EVENT_ID = "00000000-0000-4000-8000-000000000205";
const observedAt = "2026-11-24T09:00:00.000Z";

const user = {
  id: USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "e2e.supplier-inbox@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  email_confirmed_at: observedAt,
};
const initialWorkflow = {
  supplier_suborder_id: SUBORDER_ID,
  status: "awaiting_supplier",
  workflow_version: 1,
  current_terms_version: 1,
  terms_reason: null,
  response_deadline_at: null,
  created_at: observedAt,
  updated_at: observedAt,
  lines: [
    {
      buyer_request_line_id: LINE_ID,
      title: "Synthetic flour",
      sell_unit_label: "bag",
      units_per_sell_unit: 1,
      pack_amount: "5.000",
      pack_base_unit: "kg",
      quantity: 4,
      price_amount: "18.2500",
      currency: "KZT",
    },
  ],
};

type JsonObject = Record<string, unknown>;
function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function requestBody(route: Route): JsonObject {
  const raw = route.request().postData();
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  return isJsonObject(parsed) ? parsed : {};
}
async function fulfillJson(route: Route, body: unknown, status = 200): Promise<void> {
  const count = Array.isArray(body) ? body.length : 1;
  await route.fulfill({
    status,
    contentType: "application/json",
    headers: {
      "content-range": `0-${Math.max(0, count - 1)}/${count}`,
      "x-supabase-api-version": "2024-01-01",
    },
    body: JSON.stringify(body),
  });
}

async function installSupabaseMocks(
  page: Page,
  options: {
    readonly organizationType?: "supplier" | "buyer";
    readonly role?: "owner" | "order_operator" | "catalog_operator" | "buyer";
    readonly denyInbox?: boolean;
  } = {},
) {
  const organizationType = options.organizationType ?? "supplier";
  const role = options.role ?? "order_operator";
  let listedWorkflow = { ...initialWorkflow };
  let listCalls = 0;
  let acceptCall: JsonObject | null = null;

  await page.route(`${LOCAL_SUPABASE_URL}/auth/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/token")) {
      await fulfillJson(route, {
        access_token: "synthetic-e2e-access-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "synthetic-e2e-refresh-token",
        user,
      });
      return;
    }
    if (request.method() === "GET" && url.pathname.endsWith("/user")) {
      await fulfillJson(route, user);
      return;
    }
    await fulfillJson(route, {});
  });

  await page.route(`${LOCAL_SUPABASE_URL}/rest/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const table = url.pathname.split("/").at(-1) ?? "";
    if (url.pathname.includes("/rpc/")) {
      const body = requestBody(route);
      if (table.endsWith("list_supplier_suborders")) {
        listCalls += 1;
        if (options.denyInbox) {
          await fulfillJson(
            route,
            {
              code: "42501",
              message: "synthetic foreign tenant details and SQL diagnostics",
            },
            403,
          );
          return;
        }
        if (body.p_supplier_organization_id !== SUPPLIER_ID) {
          await fulfillJson(route, { code: "42501", message: "forbidden" }, 403);
          return;
        }
        await fulfillJson(route, [listedWorkflow]);
        return;
      }
      if (table.endsWith("accept_supplier_suborder")) {
        acceptCall = body;
        listedWorkflow = {
          ...listedWorkflow,
          status: "supplier_accepted",
          workflow_version: 2,
          updated_at: "2026-11-24T09:05:00.000Z",
        };
        await fulfillJson(route, {
          supplier_suborder_id: SUBORDER_ID,
          status: "supplier_accepted",
          workflow_version: 2,
          current_terms_version: 1,
          event_id: EVENT_ID,
          replayed: false,
        });
        return;
      }
      await fulfillJson(
        route,
        { code: "PGRST202", message: "unexpected synthetic RPC" },
        404,
      );
      return;
    }

    if (request.method() === "GET") {
      const rowsByTable: Record<string, unknown[]> = {
        organizations: [
          {
            id: SUPPLIER_ID,
            name: "Synthetic Supplier",
            organization_type: organizationType,
            created_by: USER_ID,
            created_at: observedAt,
          },
        ],
        organization_memberships: [{ organization_id: SUPPLIER_ID, role }],
        buyer_locations: [],
        supplier_profiles: [],
        catalog_offers: [],
        buyer_procurement_lists: [],
        buyer_procurement_list_items: [],
        buyer_draft_carts: [],
        buyer_draft_cart_items: [],
      };
      await fulfillJson(route, rowsByTable[table] ?? []);
      return;
    }
    await fulfillJson(route, []);
  });

  return {
    listCallCount: () => listCalls,
    acceptedBody: () => acceptCall,
  };
}

async function signIn(page: Page): Promise<void> {
  await page.goto("/account");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Пароль").fill("synthetic-password-123");
  await page.getByRole("button", { name: "Войти" }).last().click();
  await expect(page.getByRole("heading", { name: "Рабочее пространство" })).toBeVisible();
}

test("supplier sees own suborder details and accepts the current version", async ({
  page,
}) => {
  test.skip(
    !usesLocalAuthMock,
    "This flow runs only against the local, mocked Supabase build used by e2e:ci.",
  );
  const mocks = await installSupabaseMocks(page);
  await signIn(page);

  await expect(
    page.getByRole("heading", { name: "Входящие подзаказы поставщика" }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Список собственных подзаказов" }),
  ).toContainText("Подзаказ · 00000203");
  await expect(page.getByText("Synthetic flour", { exact: true })).toBeVisible();
  await expect(page.getByText("4 × bag (5.000 kg)", { exact: false })).toBeVisible();

  await page.getByRole("button", { name: "Принять условия" }).click();
  await expect(page.getByText(/Текущий статус: Поставщик принял условия/)).toBeVisible();
  expect(mocks.listCallCount()).toBeGreaterThanOrEqual(2);
  expect(mocks.acceptedBody()).toMatchObject({
    p_supplier_organization_id: SUPPLIER_ID,
    p_supplier_suborder_id: SUBORDER_ID,
    p_expected_version: 1,
  });
  expect(mocks.acceptedBody()?.p_idempotency_key).toEqual(expect.any(String));
});

test("supplier without order privileges cannot call the inbox RPC", async ({ page }) => {
  test.skip(
    !usesLocalAuthMock,
    "This flow runs only against the local, mocked Supabase build used by e2e:ci.",
  );
  const mocks = await installSupabaseMocks(page, { role: "catalog_operator" });
  await signIn(page);

  await expect(
    page.getByRole("heading", { name: "Входящие подзаказы поставщика" }),
  ).toBeVisible();
  await expect(page.getByRole("note")).toContainText(
    "ролью owner, admin или order_operator",
  );
  await expect(
    page.getByRole("navigation", { name: "Список собственных подзаказов" }),
  ).toHaveCount(0);
  expect(mocks.listCallCount()).toBe(0);
});

test("server tenant denial shows no foreign data or diagnostics", async ({ page }) => {
  test.skip(
    !usesLocalAuthMock,
    "This flow runs only against the local, mocked Supabase build used by e2e:ci.",
  );
  const mocks = await installSupabaseMocks(page, { denyInbox: true });
  await signIn(page);

  await expect(page.getByRole("alert")).toContainText(
    "У этой роли нет доступа к подзаказам данной организации.",
  );
  await expect(page.getByText(/foreign tenant details|SQL diagnostics/i)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Подзаказ · 00000203" })).toHaveCount(0);
  expect(mocks.listCallCount()).toBe(1);
});

test("buyer workspace never mounts the supplier inbox or requests its rows", async ({
  page,
}) => {
  test.skip(
    !usesLocalAuthMock,
    "This flow runs only against the local, mocked Supabase build used by e2e:ci.",
  );
  const mocks = await installSupabaseMocks(page, {
    organizationType: "buyer",
    role: "buyer",
  });
  await signIn(page);

  await expect(
    page.getByRole("heading", { name: "Входящие подзаказы поставщика" }),
  ).toHaveCount(0);
  expect(mocks.listCallCount()).toBe(0);
});
