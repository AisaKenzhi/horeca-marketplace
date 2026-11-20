import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Automated accessibility regression gate.
 *
 * This runs axe-core (WCAG 2.1 A/AA rule tags) against every screen a persona
 * can reach in the P0 prototype, in both desktop and mobile projects. It proves
 * the local implementation carries no *automatically detectable* violations —
 * it does not replace a manual screen-reader / keyboard pass, and it says
 * nothing about visual design quality.
 *
 * No network calls happen; the app is client-only and the scan is hermetic.
 */

const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];

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

/** Switch to a demo persona by matching its visible option text. */
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

/** Assert the current screen has no detectable WCAG 2.1 A/AA violation. */
async function expectNoA11yViolations(page: Page, screen: string): Promise<void> {
  const { violations } = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  // Surface a readable summary when it fails.
  const summary = violations
    .map(
      (v) =>
        `[${v.impact}] ${v.id}: ${v.help} @ ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    )
    .join("\n");
  expect(violations, `a11y violations on ${screen}:\n${summary}`).toEqual([]);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("accessibility: every reachable screen is free of detectable WCAG 2.1 A/AA violations", async ({
  page,
}) => {
  // Buyer screens.
  await expectNoA11yViolations(page, "catalog");

  await navTo(page, "Корзина");
  await expectNoA11yViolations(page, "basket");

  await page.getByRole("button", { name: "Отправить (демо)" }).click();
  await page.waitForURL(/\/procurement\//);
  await expectNoA11yViolations(page, "procurement confirmation");

  await navTo(page, "Закупки");
  await expectNoA11yViolations(page, "procurement list");

  await navTo(page, "Списки");
  await expectNoA11yViolations(page, "saved lists");

  await navTo(page, "Уведомления");
  await expectNoA11yViolations(page, "notifications");

  // Platform operator screens.
  await switchPersona(page, /Модератор платформы/);
  await page.waitForTimeout(200);
  await expectNoA11yViolations(page, "operator cockpit");

  await navTo(page, "Журнал");
  await expectNoA11yViolations(page, "audit journal");

  // Supplier screens (supplier-side persona).
  await switchPersona(page, /Альфа — оператор каталога/);
  await page.waitForTimeout(200);
  await expectNoA11yViolations(page, "supplier cockpit");
});
