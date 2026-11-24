import { expect, test, type Page, type Route } from "@playwright/test";

const LOCAL_SUPABASE_URL = "http://127.0.0.1:4173";
const MOCK_PUBLISHABLE_KEY = "sb_publishable_playwright-test-key";
const usesLocalAuthMock =
  process.env.VITE_SUPABASE_URL === LOCAL_SUPABASE_URL &&
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY === MOCK_PUBLISHABLE_KEY;
const USER_ID = "00000000-0000-4000-8000-000000000111";
const SUPPLIER_ID = "00000000-0000-4000-8000-000000000112";
const IMPORT_ID = "00000000-0000-4000-8000-000000000113";
const observedAt = new Date().toISOString();

const user = {
  id: USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "e2e.supplier@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  email_confirmed_at: observedAt,
};

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestBody(route: Route): Record<string, unknown> {
  const raw = route.request().postData();
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  return isJsonObject(parsed) ? parsed : {};
}

async function fulfillJson(route: Route, body: unknown): Promise<void> {
  const count = Array.isArray(body) ? body.length : 1;
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: {
      "content-range": `0-${Math.max(0, count - 1)}/${count}`,
      "x-supabase-api-version": "2024-01-01",
    },
    body: JSON.stringify(body),
  });
}

async function installSupabaseMocks(page: Page) {
  const offers: Record<string, unknown>[] = [];
  let applyCalls = 0;

  await page.route(`${LOCAL_SUPABASE_URL}/auth/v1/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname.endsWith("/token")) {
      await fulfillJson(route, {
        access_token: "mock-access-token",
        token_type: "bearer",
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        refresh_token: "mock-refresh-token",
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
      if (table.endsWith("preview_supplier_catalog_import")) {
        const rows = Array.isArray(body.p_rows) ? body.p_rows : [];
        const row = isJsonObject(rows[0]) ? rows[0] : {};
        const values = isJsonObject(row.values) ? row.values : {};
        const sku = typeof values.sku === "string" ? values.sku : null;
        const clientErrors = Array.isArray(row.client_errors) ? row.client_errors : [];
        const blocked = clientErrors.length > 0;
        await fulfillJson(route, {
          import_id: IMPORT_ID,
          status: blocked ? "blocked" : "previewed",
          summary: {
            added: blocked ? 0 : 1,
            updated: 0,
            unchanged: 0,
            errors: blocked ? 1 : 0,
          },
          rows: [
            {
              row_number: 2,
              sku,
              status: blocked ? "error" : "added",
              errors: blocked ? ["invalid_price", "invalid_currency"] : [],
              changes: blocked ? [] : ["Новая позиция"],
              expected_version: null,
            },
          ],
        });
        return;
      }
      if (table.endsWith("apply_supplier_catalog_import")) {
        applyCalls += 1;
        offers.push({
          id: "00000000-0000-4000-8000-000000000114",
          supplier_organization_id: SUPPLIER_ID,
          product_id: "00000000-0000-4000-8000-000000000115",
          supplier_sku: "CSV-SKU-1",
          title: "CSV Flour",
          category: "Dry goods",
          sell_unit_label: "bag",
          units_per_sell_unit: 1,
          pack_amount: 5,
          pack_base_unit: "kg",
          price_amount: 12.5,
          currency: "EUR",
          moq: 1,
          order_step: 1,
          availability: "in_stock",
          price_valid_until: null,
          is_published: false,
          price_observed_at: observedAt,
          availability_observed_at: observedAt,
          version: 1,
          created_at: observedAt,
          updated_at: observedAt,
        });
        await fulfillJson(route, {
          import_id: IMPORT_ID,
          status: "applied",
          summary: { added: 1, updated: 0, unchanged: 0, errors: 0 },
        });
        return;
      }
    }

    if (request.method() === "GET") {
      const rowsByTable: Record<string, unknown[]> = {
        organizations: [
          {
            id: SUPPLIER_ID,
            name: "E2E Supplier",
            organization_type: "supplier",
            created_by: USER_ID,
            created_at: observedAt,
          },
        ],
        organization_memberships: [
          { organization_id: SUPPLIER_ID, role: "catalog_operator" },
        ],
        buyer_locations: [],
        supplier_profiles: [
          {
            organization_id: SUPPLIER_ID,
            display_name: "E2E Supplier",
            verification_status: "approved",
            created_at: observedAt,
          },
        ],
        catalog_offers: offers,
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

  return { applyCallCount: () => applyCalls };
}

async function signIn(page: Page) {
  await page.goto("/account");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Пароль").fill("test-password-123");
  await page.getByRole("button", { name: "Войти" }).last().click();
  await expect(page.getByRole("heading", { name: "Рабочее пространство" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Импорт каталога из CSV" }),
  ).toBeVisible();
}

const mappedHeaders = [
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
  "CSV-SKU-1",
  "CSV Flour",
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

test("supplier maps a CSV column, reviews a persistent preview and applies all valid rows", async ({
  page,
}) => {
  test.skip(
    !usesLocalAuthMock,
    "This flow runs only against the local, mocked Supabase build used by e2e:ci.",
  );
  const mocks = await installSupabaseMocks(page);
  await signIn(page);

  await page.getByLabel("CSV-файл").setInputFiles({
    name: "supplier.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([mappedHeaders.join(","), validRow.join(",")].join("\n")),
  });
  await page.getByLabel("SKU поставщика (обязательно)").selectOption("0");
  await page.getByRole("button", { name: "Предпросмотр импорта" }).click();

  await expect(page.getByRole("heading", { name: "Предпросмотр" })).toBeVisible();
  await expect(page.getByText(/1 добавлено/)).toBeVisible();
  await expect(page.getByText("CSV-SKU-1", { exact: false })).toBeVisible();
  await expect(page.getByRole("button", { name: "Применить весь импорт" })).toBeEnabled();
  await page.getByRole("button", { name: "Применить весь импорт" }).click();

  await expect(page.getByText("Импорт применён. Каталог обновлён.")).toBeVisible();
  await expect(page.locator(".account-offer-list")).toContainText("CSV Flour");
  expect(mocks.applyCallCount()).toBe(1);
});

test("supplier cannot apply a batch with a blocking row error", async ({ page }) => {
  test.skip(
    !usesLocalAuthMock,
    "This flow runs only against the local, mocked Supabase build used by e2e:ci.",
  );
  const mocks = await installSupabaseMocks(page);
  await signIn(page);
  const invalidRow = [...validRow.slice(0, 7), "", "", ...validRow.slice(9)];
  await page.getByLabel("CSV-файл").setInputFiles({
    name: "invalid-price.csv",
    mimeType: "text/csv",
    buffer: Buffer.from([mappedHeaders.join(","), invalidRow.join(",")].join("\n")),
  });
  await page.getByLabel("SKU поставщика (обязательно)").selectOption("0");
  await page.getByRole("button", { name: "Предпросмотр импорта" }).click();

  await expect(
    page.getByText("Есть блокирующие ошибки: пакет не будет применён частично."),
  ).toBeVisible();
  await expect(
    page.getByText("Укажите положительную цену с точностью до 4 знаков."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Применить весь импорт" }),
  ).toBeDisabled();
  expect(mocks.applyCallCount()).toBe(0);
});
