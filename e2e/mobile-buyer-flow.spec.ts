import { expect, test, type Page, type Route } from "@playwright/test";

const LOCAL_SUPABASE_URL = "http://127.0.0.1:4173";
const MOCK_PUBLISHABLE_KEY = "sb_publishable_playwright-test-key";
const usesLocalAuthMock =
  process.env.VITE_SUPABASE_URL === LOCAL_SUPABASE_URL &&
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY === MOCK_PUBLISHABLE_KEY;
const MOCK_USER_ID = "00000000-0000-4000-8000-000000000021";
const BUYER_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000031";
const BUYER_LOCATION_ID = "00000000-0000-4000-8000-000000000041";
const SUPPLIER_ORGANIZATION_ID = "00000000-0000-4000-8000-000000000081";
const OFFER_ID = "00000000-0000-4000-8000-000000000051";
const DRAFT_CART_ID = "00000000-0000-4000-8000-000000000061";
const DRAFT_CART_ITEM_ID = "00000000-0000-4000-8000-000000000071";
const REQUEST_ID = "00000000-0000-4000-8000-000000000099";
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
    organization_id: SUPPLIER_ORGANIZATION_ID,
    display_name: "Fresh supplier",
    verification_status: "approved",
    created_at: observedAt,
  },
];
const offers = [
  {
    id: OFFER_ID,
    supplier_organization_id: SUPPLIER_ORGANIZATION_ID,
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

interface CartMock {
  id: string;
  organization_id: string;
  buyer_location_id: string | null;
  source_list_name: string;
  created_by: string;
  created_at: string;
  submitted_at: string | null;
}

interface CartItemMock {
  id: string;
  organization_id: string;
  cart_id: string;
  catalog_offer_id: string;
  quantity: number;
  catalog_offer_version: number;
  created_at: string;
  updated_at: string;
}

interface E2EMockState {
  carts: CartMock[];
  cartItems: CartItemMock[];
  requests: Record<string, unknown>[];
  requestLines: Record<string, unknown>[];
  requestCalls: number;
  idempotencyKeysUsed: string[];
  mutations: string[];
  externalRequests: string[];
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requestBody(route: Route): Record<string, unknown> {
  const raw = route.request().postData();
  if (!raw) return {};
  const parsed: unknown = JSON.parse(raw);
  return isJsonObject(parsed) ? parsed : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
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

async function installLocalSupabaseMocks(page: Page): Promise<E2EMockState> {
  const carts: CartMock[] = [
    {
      id: DRAFT_CART_ID,
      organization_id: BUYER_ORGANIZATION_ID,
      buyer_location_id: null,
      source_list_name: "Mobile smoke list",
      created_by: MOCK_USER_ID,
      created_at: "2026-11-24T00:00:01.000Z",
      submitted_at: null,
    },
  ];
  const cartItems: CartItemMock[] = [
    {
      id: DRAFT_CART_ITEM_ID,
      organization_id: BUYER_ORGANIZATION_ID,
      cart_id: DRAFT_CART_ID,
      catalog_offer_id: OFFER_ID,
      quantity: 2,
      catalog_offer_version: 1,
      created_at: observedAt,
      updated_at: observedAt,
    },
  ];
  const state: E2EMockState = {
    carts,
    cartItems,
    requests: [],
    requestLines: [],
    requestCalls: 0,
    idempotencyKeysUsed: [],
    mutations: [],
    externalRequests: [],
  };

  page.on("request", (request) => {
    const url = new URL(request.url());
    if (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.origin !== LOCAL_SUPABASE_URL
    ) {
      state.externalRequests.push(url.origin);
    }
  });

  // Keep the run hermetic: abort any request that attempts to leave local preview.
  await page.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== LOCAL_SUPABASE_URL) {
      await route.abort();
      return;
    }
    await route.fallback();
  });

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
    const method = request.method();

    if (method === "GET") {
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
        buyer_procurement_requests: state.requests,
        buyer_procurement_request_lines: state.requestLines,
      };
      await fulfillJson(route, rowsByTable[table] ?? []);
      return;
    }

    // Buyer terms review is a read-only RPC; it must not be recorded as a
    // side-effecting mutation in this hermetic mock.
    if (method === "POST" && table === "list_buyer_supplier_suborder_workflows") {
      await fulfillJson(route, []);
      return;
    }
    // Moderator capability check is read-only; this synthetic buyer is not one.
    if (method === "POST" && table === "is_platform_moderator") {
      await fulfillJson(route, false);
      return;
    }

    const body = requestBody(route);
    const rowId = url.searchParams.get("id")?.replace(/^eq\./, "");
    if (method === "PATCH" && table === "buyer_draft_carts") {
      state.mutations.push("PATCH buyer_draft_carts");
      const cart = carts.find((candidate) => candidate.id === rowId);
      if (cart && typeof body.buyer_location_id === "string") {
        cart.buyer_location_id = body.buyer_location_id;
      }
      await fulfillJson(route, cart ? [cart] : []);
      return;
    }

    if (method === "POST" && table === "create_buyer_procurement_request") {
      state.mutations.push(`POST ${table}`);
      state.requestCalls += 1;
      const cartId = stringValue(body.p_cart_id);
      const cart = carts.find((candidate) => candidate.id === cartId);
      const idempotencyKey = stringValue(body.p_idempotency_key);
      state.idempotencyKeysUsed.push(idempotencyKey);
      if (!cart) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ code: "P0002", message: "draft cart not found" }),
        });
        return;
      }

      const submittedAt = new Date().toISOString();
      state.requests.push({
        id: REQUEST_ID,
        organization_id: cart.organization_id,
        draft_cart_id: cart.id,
        buyer_location_id: cart.buyer_location_id,
        seller_type: "platform",
        request_status: "submitted",
        source_list_name: cart.source_list_name,
        submitted_by: MOCK_USER_ID,
        submitted_at: submittedAt,
      });
      for (const item of cartItems.filter((candidate) => candidate.cart_id === cart.id)) {
        const offer = offers.find((candidate) => candidate.id === item.catalog_offer_id);
        if (!offer) continue;
        state.requestLines.push({
          id: `request-line-${item.id}`,
          organization_id: cart.organization_id,
          request_id: REQUEST_ID,
          catalog_offer_id: offer.id,
          quantity: item.quantity,
          title: offer.title,
          sell_unit_label: offer.sell_unit_label,
          units_per_sell_unit: offer.units_per_sell_unit,
          pack_amount: offer.pack_amount,
          pack_base_unit: offer.pack_base_unit,
          price_amount: offer.price_amount,
          currency: offer.currency,
          availability: offer.availability,
          catalog_offer_version: offer.version,
          price_observed_at: offer.price_observed_at,
          availability_observed_at: offer.availability_observed_at,
          created_at: submittedAt,
        });
      }
      cart.submitted_at = submittedAt;
      await fulfillJson(route, REQUEST_ID);
      return;
    }

    if (method === "POST" || method === "PATCH" || method === "DELETE") {
      state.mutations.push(`${method} ${table}`);
    }
    await fulfillJson(route, []);
  });

  return state;
}

async function expectNoHorizontalOverflow(page: Page, screen: string): Promise<void> {
  const { documentWidth, viewportWidth } = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(
    documentWidth,
    `horizontal overflow on ${screen}: document ${documentWidth}px, viewport ${viewportWidth}px`,
  ).toBeLessThanOrEqual(viewportWidth);
}

test("mobile buyer registers a persisted pending platform request without external actions", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "mobile-chromium" || !usesLocalAuthMock,
    "Runs only on mobile Chromium with the local mocked Supabase build from e2e:ci.",
  );

  await page.setViewportSize({ width: 390, height: 844 });
  const mockState = await installLocalSupabaseMocks(page);
  const confirmations: string[] = [];
  page.on("dialog", async (dialog) => {
    confirmations.push(dialog.message());
    await dialog.accept();
  });

  await page.goto("/account");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Пароль").fill("test-password-123");
  await page.getByRole("button", { name: "Войти" }).last().click();

  await expect(page.getByRole("heading", { name: "Рабочее пространство" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Каталог для покупателей" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Новые черновые корзины" }),
  ).toBeVisible();
  await expect(page.getByText("E2E flour", { exact: true }).first()).toBeVisible();
  await expectNoHorizontalOverflow(page, "catalog and draft cart");

  const cart = page.locator(".draft-cart-card").filter({ hasText: "Mobile smoke list" });
  const submit = cart.getByRole("button", { name: "Создать запрос закупки" });
  await expect(submit).toBeVisible();
  await expect(submit).toBeDisabled();
  await cart
    .getByLabel("Точка покупателя для этой корзины")
    .selectOption(BUYER_LOCATION_ID);
  await expect(cart.locator(".draft-cart-review")).toContainText(
    "Проверки по доступным данным пройдены.",
  );
  await expect(submit).toBeEnabled();
  await expectNoHorizontalOverflow(page, "reviewed draft cart");

  await submit.click();
  await expect(page.getByRole("heading", { name: "Запросы закупки" })).toBeVisible();
  expect(confirmations).toHaveLength(1);
  expect(confirmations[0]).toContain("Это не означает принятие или оплату заказа");
  expect(confirmations[0]).toContain("поставщики не уведомляются");

  const requestCard = page.locator(".buyer-request-card");
  await expect(requestCard).toHaveCount(1);
  await expect(requestCard).toContainText("Зарегистрирован");
  await expect(requestCard).toContainText("не принят и не оплачен");
  await expect(requestCard).toContainText("поставщики не уведомлены");
  await expect(requestCard).toContainText("Снимок цены при регистрации");
  await expect(requestCard).toContainText("E2E flour");
  await expectNoHorizontalOverflow(page, "registered pending request");

  expect(mockState.requestCalls).toBe(1);
  expect(mockState.requests).toHaveLength(1);
  expect(mockState.requests[0]?.request_status).toBe("submitted");
  expect(mockState.requests[0]?.seller_type).toBe("platform");
  expect(mockState.requestLines).toHaveLength(1);
  expect(mockState.idempotencyKeysUsed).toHaveLength(1);
  expect(mockState.carts[0]?.submitted_at).toBeTruthy();
  expect(mockState.mutations).toEqual([
    "PATCH buyer_draft_carts",
    "POST create_buyer_procurement_request",
  ]);

  // Reload proves the UI reads the pending request from the mocked persisted rows.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Запросы закупки" })).toBeVisible();
  await expect(page.locator(".buyer-request-card")).toContainText("Зарегистрирован");
  await expect(page.locator(".buyer-request-card")).toContainText(
    "не принят и не оплачен",
  );
  await expectNoHorizontalOverflow(page, "reloaded pending request");

  expect(mockState.requestCalls).toBe(1);
  expect(mockState.requests).toHaveLength(1);
  expect(mockState.mutations).toEqual([
    "PATCH buyer_draft_carts",
    "POST create_buyer_procurement_request",
  ]);
  expect(mockState.externalRequests).toEqual([]);
});
