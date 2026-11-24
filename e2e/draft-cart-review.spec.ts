import { expect, test, type Page, type Route } from "@playwright/test";

const LOCAL_SUPABASE_URL = "http://127.0.0.1:4173";
const MOCK_PUBLISHABLE_KEY = "sb_publishable_playwright-test-key";
const usesLocalAuthMock =
  process.env.VITE_SUPABASE_URL === LOCAL_SUPABASE_URL &&
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY === MOCK_PUBLISHABLE_KEY;
const MOCK_USER_ID = "00000000-0000-4000-8000-000000000021";
const BUYER_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000031";
const BUYER_LOCATION_ID = "00000000-0000-4000-8000-000000000041";
const OFFER_ID = "00000000-0000-4000-8000-000000000051";
const LOCATION_CART_ID = "00000000-0000-4000-8000-000000000061";
const QUANTITY_CART_ID = "00000000-0000-4000-8000-000000000062";
const LOCATION_ITEM_ID = "00000000-0000-4000-8000-000000000071";
const QUANTITY_ITEM_ID = "00000000-0000-4000-8000-000000000072";
const observedAt = new Date().toISOString();
const priceValidUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const user = {
  id: MOCK_USER_ID,
  aud: "authenticated",
  role: "authenticated",
  email: "e2e.buyer@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  email_confirmed_at: observedAt,
};

const organizations = [
  {
    id: BUYER_ORGANIZATION_ID,
    name: "E2E Buyer",
    organization_type: "buyer",
    created_by: MOCK_USER_ID,
    created_at: observedAt,
  },
];
const locations = [
  {
    id: BUYER_LOCATION_ID,
    organization_id: BUYER_ORGANIZATION_ID,
    name: "Warsaw kitchen",
    address: "Test address",
    delivery_zone: "Warsaw",
    created_at: observedAt,
  },
];
const suppliers = [
  {
    organization_id: "00000000-0000-4000-8000-000000000081",
    display_name: "Fresh supplier",
    verification_status: "approved",
    created_at: observedAt,
  },
];
const offers = [
  {
    id: OFFER_ID,
    supplier_organization_id: suppliers[0]!.organization_id,
    product_id: null,
    supplier_sku: "E2E-FLOUR",
    title: "E2E flour",
    category: "Food",
    sell_unit_label: "bag",
    units_per_sell_unit: 1,
    pack_amount: 5,
    pack_base_unit: "kg",
    price_amount: 12.5,
    currency: "KZT",
    moq: 2,
    order_step: 1,
    availability: "in_stock",
    price_valid_until: priceValidUntil,
    is_published: true,
    price_observed_at: observedAt,
    availability_observed_at: observedAt,
    version: 1,
    created_at: observedAt,
    updated_at: observedAt,
  },
];
const carts = [
  {
    id: QUANTITY_CART_ID,
    organization_id: BUYER_ORGANIZATION_ID,
    buyer_location_id: BUYER_LOCATION_ID,
    source_list_name: "Fix quantity",
    created_by: MOCK_USER_ID,
    created_at: "2026-11-24T00:00:02.000Z",
  },
  {
    id: LOCATION_CART_ID,
    organization_id: BUYER_ORGANIZATION_ID,
    buyer_location_id: null,
    source_list_name: "Select location",
    created_by: MOCK_USER_ID,
    created_at: "2026-11-24T00:00:01.000Z",
  },
];
const cartItems = [
  {
    id: QUANTITY_ITEM_ID,
    organization_id: BUYER_ORGANIZATION_ID,
    cart_id: QUANTITY_CART_ID,
    catalog_offer_id: OFFER_ID,
    quantity: 1,
    catalog_offer_version: 1,
    created_at: observedAt,
    updated_at: observedAt,
  },
  {
    id: LOCATION_ITEM_ID,
    organization_id: BUYER_ORGANIZATION_ID,
    cart_id: LOCATION_CART_ID,
    catalog_offer_id: OFFER_ID,
    quantity: 2,
    catalog_offer_version: 1,
    created_at: observedAt,
    updated_at: observedAt,
  },
];

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

async function installSupabaseMocks(page: Page): Promise<void> {
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
    if (request.method() === "GET") {
      const rowsByTable: Record<string, unknown[]> = {
        organizations,
        organization_memberships: [
          { organization_id: BUYER_ORGANIZATION_ID, role: "buyer" },
        ],
        buyer_locations: locations,
        supplier_profiles: suppliers,
        catalog_offers: offers,
        buyer_procurement_lists: [],
        buyer_procurement_list_items: [],
        buyer_draft_carts: carts,
        buyer_draft_cart_items: cartItems,
      };
      await fulfillJson(route, rowsByTable[table] ?? []);
      return;
    }

    const body = requestBody(route);
    const rowId = url.searchParams.get("id")?.replace(/^eq\./, "");
    if (request.method() === "PATCH" && table === "buyer_draft_carts") {
      const cart = carts.find((candidate) => candidate.id === rowId);
      if (cart) Object.assign(cart, body);
      await fulfillJson(route, cart ? [cart] : []);
      return;
    }
    if (request.method() === "PATCH" && table === "buyer_draft_cart_items") {
      const item = cartItems.find((candidate) => candidate.id === rowId);
      if (item && typeof body.quantity === "number") {
        item.quantity = body.quantity;
        item.updated_at = new Date().toISOString();
      }
      await fulfillJson(route, item ? [item] : []);
      return;
    }
    if (request.method() === "DELETE" && table === "buyer_draft_cart_items") {
      const index = cartItems.findIndex((candidate) => candidate.id === rowId);
      const [deleted] = index >= 0 ? cartItems.splice(index, 1) : [];
      await fulfillJson(route, deleted ? [deleted] : []);
      return;
    }
    await fulfillJson(route, []);
  });
}

test("buyer reviews saved draft carts, selects an owned location and fixes MOQ", async ({
  page,
}) => {
  test.skip(
    !usesLocalAuthMock,
    "This flow runs only against the local, mocked Supabase build used by e2e:ci.",
  );
  await installSupabaseMocks(page);
  await page.goto("/account");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Пароль").fill("test-password-123");
  await page.getByRole("button", { name: "Войти" }).last().click();

  await expect(page.getByRole("heading", { name: "Рабочее пространство" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Новые черновые корзины" }),
  ).toBeVisible();

  const locationCart = page
    .locator(".draft-cart-card")
    .filter({ hasText: "Select location" });
  await expect(locationCart).toContainText(
    "Выберите точку покупателя для этой черновой корзины.",
  );
  await locationCart
    .getByLabel("Точка покупателя для этой корзины")
    .selectOption(BUYER_LOCATION_ID);
  await expect(locationCart.locator(".draft-cart-review")).toContainText(
    "Проверки по доступным данным пройдены.",
  );
  await expect(locationCart.locator(".draft-cart-review")).toContainText(
    "покрытие и доставка не подтверждены",
  );

  const quantityCart = page
    .locator(".draft-cart-card")
    .filter({ hasText: "Fix quantity" });
  await expect(quantityCart).toContainText("Минимальный заказ по позиции: 2.");
  const quantityInput = quantityCart.getByLabel(
    "Количество в черновике (продаваемые единицы)",
  );
  await quantityInput.fill("2");
  await quantityCart
    .getByRole("button", { name: "Сохранить количество в корзине" })
    .click();
  await expect(quantityCart.locator(".draft-cart-review")).toContainText(
    "Проверки по доступным данным пройдены.",
  );
  await expect(quantityCart).toContainText("Подытог по поставщику");
  await expect(quantityCart).not.toContainText("Минимальный заказ по позиции: 2.");
  await expect(page.getByRole("button", { name: "Оформить заказ" })).toHaveCount(0);
});
