import { test, expect, type Page } from "@playwright/test";

/**
 * End-to-end scenario for the P0 prototype.
 *
 * IMPORTANT: this is a client-only prototype whose state lives in memory for
 * the lifetime of the page. A full browser navigation (`page.goto`) resets that
 * state. Tests therefore navigate using in-app links/clicks once the app is
 * loaded, and only use `page.goto("/")` for the very first load.
 *
 * No network calls happen and no real orders, payments or messages are created.
 */

async function switchPersona(page: Page, match: RegExp): Promise<void> {
  const select = page.getByLabel("Выбор демонстрационной роли");
  const options = select.locator("option");
  const count = await options.count();
  for (let i = 0; i < count; i += 1) {
    const text = await options.nth(i).textContent();
    if (text && match.test(text)) {
      const value = await options.nth(i).getAttribute("value");
      if (value) await select.selectOption(value);
      return;
    }
  }
  throw new Error(`Persona not found for ${match}`);
}

/** Client-side nav via the primary navigation links (opens the mobile menu if needed). */
async function navTo(page: Page, name: string): Promise<void> {
  const toggle = page.getByRole("button", { name: "Меню" });
  if (await toggle.isVisible()) {
    const nav = page.locator("nav#primary-nav");
    if (!(await nav.isVisible())) await toggle.click();
  }
  await page
    .locator("nav#primary-nav")
    .getByRole("link", { name, exact: false })
    .first()
    .click();
}

/**
 * The seed basket now defaults to a submittable state for both suppliers, so no
 * extra setup is needed. This helper is kept for clarity/documentation.
 */
async function ensureBasketReady(page: Page): Promise<void> {
  await navTo(page, "Корзина");
  await expect(page.getByRole("button", { name: "Отправить (демо)" })).toBeEnabled();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("buyer sees per-supplier grouping in the basket, not one bill", async ({ page }) => {
  await navTo(page, "Корзина");
  await expect(page.getByRole("heading", { name: /Корзина/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Поставщик «Альфа» \(демо\)/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: /Поставщик «Бета» \(демо\)/ }),
  ).toBeVisible();
  await expect(page.getByText(/стоимость доставки не указана/).first()).toBeVisible();
});

test("full negotiation flow: submit, supplier change, buyer acceptance", async ({
  page,
}) => {
  const user = /владелец кафе/i;

  await switchPersona(page, user);
  await ensureBasketReady(page);

  await page.getByRole("button", { name: "Отправить (демо)" }).click();
  await navTo(page, "Закупки");
  await expect(page.getByText(/Родительская закупка/)).toBeVisible();

  // Switch to the Alpha order operator and propose a change.
  await switchPersona(page, /оператор заказов/i);
  await navTo(page, "Кабинет поставщика");
  const propose = page.getByRole("button", { name: "Предложить изменение" }).first();
  await expect(propose).toBeVisible();
  await propose.click();

  // Back as the buyer: nothing is auto-applied; an explicit decision is required.
  await switchPersona(page, user);
  await navTo(page, "Закупки");
  const awaitingRow = page
    .locator(".suborder-item")
    .filter({ hasText: "Ожидает решения покупателя" })
    .first();
  await expect(awaitingRow).toBeVisible();
  await awaitingRow.getByRole("link", { name: "Открыть" }).click();
  await expect(page.getByText(/Поставщик предложил изменение/)).toBeVisible();
  await page.getByRole("button", { name: "Принять изменение" }).first().click();
  await expect(page.getByText(/Согласование: Подтверждено/).first()).toBeVisible();
});

test("supplier cannot see another supplier's suborders", async ({ page }) => {
  await switchPersona(page, /владелец кафе/i);
  await ensureBasketReady(page);
  await page.getByRole("button", { name: "Отправить (демо)" }).click();

  await switchPersona(page, /Альфа — оператор заказов/i);
  await navTo(page, "Кабинет поставщика");
  const main = page.locator("main#main");
  await expect(main.locator(".suborder-list").first()).toBeVisible();
  // Beta's name must never appear in Alpha's workspace main area.
  await expect(main.getByText(/Бета/)).toHaveCount(0);
});

test("catalog accessibility: keyboard can reach and activate add-to-basket", async ({
  page,
}) => {
  await navTo(page, "Каталог");
  const firstAdd = page.getByRole("button", { name: "В корзину" }).first();
  await firstAdd.focus();
  await expect(firstAdd).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByText(/добавлена в корзину/i)).toBeVisible();
});

test("stale and unknown values are flagged, not shown as current", async ({ page }) => {
  await navTo(page, "Каталог");
  await expect(page.getByText(/устарело/).first()).toBeVisible();
  await expect(page.getByText(/не указано/).first()).toBeVisible();
});
