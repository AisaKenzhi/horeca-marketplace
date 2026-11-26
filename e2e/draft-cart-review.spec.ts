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

const cartSeeds: CartMock[] = [
  {
    id: QUANTITY_CART_ID,
    organization_id: BUYER_ORGANIZATION_ID,
    buyer_location_id: BUYER_LOCATION_ID,
    source_list_name: "Fix quantity",
    created_by: MOCK_USER_ID,
    created_at: "2026-11-24T00:00:02.000Z",
    submitted_at: null,
  },
  {
    id: LOCATION_CART_ID,
    organization_id: BUYER_ORGANIZATION_ID,
    buyer_location_id: null,
    source_list_name: "Select location",
    created_by: MOCK_USER_ID,
    created_at: "2026-11-24T00:00:01.000Z",
    submitted_at: null,
  },
];
const carts = cartSeeds.map((cart) => ({ ...cart }));
const cartItemSeeds: CartItemMock[] = [
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
const cartItems = cartItemSeeds.map((item) => ({ ...item }));
const procurementRequests: Record<string, unknown>[] = [];
const procurementRequestLines: Record<string, unknown>[] = [];
const idempotencyKeys = new Map<string, string>();

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
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

interface E2ESupabaseMockState {
  forceStaleOnSubmit: boolean;
  failAfterPersistOnce: boolean;
  requestCalls: number;
  idempotencyKeysUsed: string[];
}

async function installSupabaseMocks(
  page: Page,
  options: { readonly offers?: typeof offers } = {},
): Promise<E2ESupabaseMockState> {
  const activeOffers = options.offers ?? offers;
  carts.splice(0, carts.length, ...cartSeeds.map((cart) => ({ ...cart })));
  cartItems.splice(0, cartItems.length, ...cartItemSeeds.map((item) => ({ ...item })));
  procurementRequests.splice(0, procurementRequests.length);
  procurementRequestLines.splice(0, procurementRequestLines.length);
  idempotencyKeys.clear();
  const state: E2ESupabaseMockState = {
    forceStaleOnSubmit: false,
    failAfterPersistOnce: false,
    requestCalls: 0,
    idempotencyKeysUsed: [],
  };

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
        catalog_offers: activeOffers,
        buyer_procurement_lists: [],
        buyer_procurement_list_items: [],
        buyer_draft_carts: carts,
        buyer_draft_cart_items: cartItems,
        buyer_procurement_requests: procurementRequests,
        buyer_procurement_request_lines: procurementRequestLines,
      };
      await fulfillJson(route, rowsByTable[table] ?? []);
      return;
    }

    const body = requestBody(route);
    const rowId = url.searchParams.get("id")?.replace(/^eq\./, "");
    if (
      request.method() === "POST" &&
      table === "update_buyer_draft_cart_item_quantity"
    ) {
      const itemId = stringValue(body.p_item_id);
      const item = cartItems.find((candidate) => candidate.id === itemId);
      if (item && typeof body.p_quantity === "number") {
        item.quantity = body.p_quantity;
        item.updated_at = new Date().toISOString();
      }
      await fulfillJson(route, item ? item.id : null);
      return;
    }
    if (request.method() === "POST" && table === "delete_buyer_draft_cart_item") {
      const itemId = stringValue(body.p_item_id);
      const index = cartItems.findIndex((candidate) => candidate.id === itemId);
      if (index >= 0) cartItems.splice(index, 1);
      await fulfillJson(route, index >= 0);
      return;
    }
    if (request.method() === "POST" && table === "create_buyer_procurement_request") {
      state.requestCalls += 1;
      const organizationId = stringValue(body.p_organization_id);
      const idempotencyKey = stringValue(body.p_idempotency_key);
      state.idempotencyKeysUsed.push(idempotencyKey);
      if (state.forceStaleOnSubmit) {
        state.forceStaleOnSubmit = false;
        await route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({
            code: "40001",
            message: "catalog terms changed or are not current",
          }),
        });
        return;
      }
      const cart = carts.find((candidate) => candidate.id === body.p_cart_id);
      if (!cart) {
        await route.fulfill({
          status: 404,
          contentType: "application/json",
          body: JSON.stringify({ code: "P0002", message: "draft cart not found" }),
        });
        return;
      }
      const key = `${organizationId}:${idempotencyKey}`;
      const replay = idempotencyKeys.get(key);
      if (replay) {
        await fulfillJson(route, replay);
        return;
      }
      const requestId = "00000000-0000-4000-8000-000000000099";
      const submittedAt = new Date().toISOString();
      procurementRequests.push({
        id: requestId,
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
        const offer = activeOffers.find(
          (candidate) => candidate.id === item.catalog_offer_id,
        );
        if (!offer) continue;
        procurementRequestLines.push({
          id: `request-line-${item.id}`,
          organization_id: cart.organization_id,
          request_id: requestId,
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
      idempotencyKeys.set(key, requestId);
      cart.submitted_at = submittedAt;
      if (state.failAfterPersistOnce) {
        state.failAfterPersistOnce = false;
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({ message: "synthetic lost response after commit" }),
        });
        return;
      }
      await fulfillJson(route, requestId);
      return;
    }
    if (request.method() === "PATCH" && table === "buyer_draft_carts") {
      const cart = carts.find((candidate) => candidate.id === rowId);
      if (cart) Object.assign(cart, body);
      await fulfillJson(route, cart ? [cart] : []);
      return;
    }
    await fulfillJson(route, []);
  });
  return state;
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

test("buyer explicitly creates a platform request without accepting or paying an order", async ({
  page,
}) => {
  test.skip(
    !usesLocalAuthMock,
    "This flow runs only against the local, mocked Supabase build used by e2e:ci.",
  );
  const mockState = await installSupabaseMocks(page);
  const confirmations: string[] = [];
  page.on("dialog", async (dialog) => {
    confirmations.push(dialog.message());
    await dialog.accept();
  });
  await page.goto("/account");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Пароль").fill("test-password-123");
  await page.getByRole("button", { name: "Войти" }).last().click();

  const cart = page.locator(".draft-cart-card").filter({ hasText: "Select location" });
  await cart
    .getByLabel("Точка покупателя для этой корзины")
    .selectOption(BUYER_LOCATION_ID);
  const submit = cart.getByRole("button", { name: "Создать запрос закупки" });
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByRole("heading", { name: "Запросы закупки" })).toBeVisible();
  const requestCard = page.locator(".buyer-request-card");
  await expect(requestCard).toContainText("Продавец: Платформа");
  await expect(requestCard).toContainText("Снимок цены при регистрации");
  await expect(requestCard).toContainText("не принят и не оплачен");
  await expect(requestCard).toContainText("поставщики не уведомлены");
  await expect(requestCard).toContainText("без количественного остатка");
  expect(confirmations).toHaveLength(1);
  expect(confirmations[0]).toContain("Это не означает принятие или оплату заказа");
  expect(mockState.requestCalls).toBe(1);
  expect(procurementRequests).toHaveLength(1);
  expect(procurementRequestLines).toHaveLength(1);
  expect(
    carts.find((candidate) => candidate.id === LOCATION_CART_ID)?.submitted_at,
  ).toBeTruthy();
});

test("server-side stale-price recheck blocks request creation", async ({ page }) => {
  test.skip(
    !usesLocalAuthMock,
    "This flow runs only against the local, mocked Supabase build used by e2e:ci.",
  );
  const mockState = await installSupabaseMocks(page);
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/account");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Пароль").fill("test-password-123");
  await page.getByRole("button", { name: "Войти" }).last().click();

  const cart = page.locator(".draft-cart-card").filter({ hasText: "Select location" });
  await cart
    .getByLabel("Точка покупателя для этой корзины")
    .selectOption(BUYER_LOCATION_ID);
  const submit = cart.getByRole("button", { name: "Создать запрос закупки" });
  await expect(submit).toBeEnabled();
  mockState.forceStaleOnSubmit = true;
  await submit.click();

  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Каталог изменился или данные цены и наличия устарели" }),
  ).toContainText("Каталог изменился или данные цены и наличия устарели");
  expect(mockState.requestCalls).toBe(1);
  expect(procurementRequests).toHaveLength(0);
  expect(
    carts.find((candidate) => candidate.id === LOCATION_CART_ID)?.submitted_at,
  ).toBeNull();
});

test("replaying after an ambiguous response returns the same persisted request", async ({
  page,
}) => {
  test.skip(
    !usesLocalAuthMock,
    "This flow runs only against the local, mocked Supabase build used by e2e:ci.",
  );
  const mockState = await installSupabaseMocks(page);
  mockState.failAfterPersistOnce = true;
  page.on("dialog", (dialog) => dialog.accept());
  await page.goto("/account");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Пароль").fill("test-password-123");
  await page.getByRole("button", { name: "Войти" }).last().click();

  const cart = page.locator(".draft-cart-card").filter({ hasText: "Select location" });
  await cart
    .getByLabel("Точка покупателя для этой корзины")
    .selectOption(BUYER_LOCATION_ID);
  const submit = cart.getByRole("button", { name: "Создать запрос закупки" });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Не удалось связаться с рабочим контуром" }),
  ).toBeVisible();
  expect(procurementRequests).toHaveLength(1);

  await submit.click();
  await expect(page.locator(".buyer-request-card")).toContainText(
    "не принят и не оплачен",
  );
  expect(mockState.requestCalls).toBe(2);
  expect(mockState.idempotencyKeysUsed).toHaveLength(2);
  expect(mockState.idempotencyKeysUsed[0]).toMatch(/^[0-9a-f-]{36}$/i);
  expect(mockState.idempotencyKeysUsed[1]).toBe(mockState.idempotencyKeysUsed[0]);
  expect(procurementRequests).toHaveLength(1);
  expect(procurementRequestLines).toHaveLength(1);
  expect(
    carts.find((candidate) => candidate.id === LOCATION_CART_ID)?.submitted_at,
  ).toBeTruthy();
});

test("UAT: an empty catalog is stated honestly and never looks sendable", async ({
  page,
}) => {
  test.skip(
    !usesLocalAuthMock,
    "UAT runs only against the local, mocked Supabase build used by e2e:ci.",
  );
  await installSupabaseMocks(page, { offers: [] });
  await page.goto("/account");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Пароль").fill("test-password-123");
  await page.getByRole("button", { name: "Войти" }).last().click();

  await expect(
    page.getByText("Пока нет опубликованных предложений одобренных поставщиков."),
  ).toBeVisible();
  const cart = page.locator(".draft-cart-card").filter({ hasText: "Select location" });
  await expect(cart).toContainText("Есть блокирующие пункты");
  await expect(cart.locator(".draft-cart-review")).toContainText("заблокировано: 1");
  await expect(
    cart.getByRole("button", { name: "Создать запрос закупки" }),
  ).toBeDisabled();
});

test("UAT: a changed offer version is an explicit blocker, not a silent send", async ({
  page,
}) => {
  test.skip(
    !usesLocalAuthMock,
    "UAT runs only against the local, mocked Supabase build used by e2e:ci.",
  );
  const changedOffers = offers.map((offer) =>
    offer.id === OFFER_ID ? { ...offer, version: 2 } : offer,
  );
  await installSupabaseMocks(page, { offers: changedOffers });
  await page.goto("/account");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Пароль").fill("test-password-123");
  await page.getByRole("button", { name: "Войти" }).last().click();

  const cart = page.locator(".draft-cart-card").filter({ hasText: "Select location" });
  await expect(cart).toContainText(
    "Условия предложения изменились после создания корзины",
  );
  await expect(cart.locator(".draft-cart-review")).toContainText(
    "цену и условия нужно проверить заново",
  );
  await expect(
    cart.getByRole("button", { name: "Создать запрос закупки" }),
  ).toBeDisabled();
});

test("UAT keyboard/reflow: location select and submit are reachable without a mouse", async ({
  page,
}) => {
  test.skip(
    !usesLocalAuthMock,
    "Runs only against the local, mocked Supabase build used by e2e:ci.",
  );
  await installSupabaseMocks(page);
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("/account");
  await page.getByLabel("Email").fill(user.email);
  await page.getByLabel("Пароль").fill("test-password-123");
  await page.getByRole("button", { name: "Войти" }).last().click();

  const cart = page.locator(".draft-cart-card").filter({ hasText: "Select location" });
  const select = cart.getByLabel("Точка покупателя для этой корзины");
  await select.focus();
  await expect(select).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(cart.locator(".draft-cart-review")).toContainText(
    "Проверки по доступным данным пройдены",
  );

  const submit = cart.getByRole("button", { name: "Создать запрос закупки" });
  await expect(submit).toBeEnabled();
  await submit.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Запросы закупки" })).toBeVisible();

  await page.setViewportSize({ width: 320, height: 700 });
  const overflow = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
});
