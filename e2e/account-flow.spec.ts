import { test, expect, type Page } from "@playwright/test";

const LOCAL_SUPABASE_URL = "http://127.0.0.1:4173";
const MOCK_PUBLISHABLE_KEY = "sb_publishable_playwright-test-key";
const hasSupabaseConfiguration = Boolean(
  process.env.VITE_SUPABASE_URL?.trim() &&
  (process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.VITE_SUPABASE_ANON_KEY?.trim()),
);
const usesLocalAuthMock =
  process.env.VITE_SUPABASE_URL === LOCAL_SUPABASE_URL &&
  (process.env.VITE_SUPABASE_PUBLISHABLE_KEY === MOCK_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY === MOCK_PUBLISHABLE_KEY);

interface MockResponse {
  readonly status: number;
  readonly body: unknown;
}

async function mockAuthEndpoint(
  page: Page,
  respond: (
    pathname: string,
    requestBody: Record<string, unknown>,
    method: string,
  ) => MockResponse,
): Promise<void> {
  await page.route(`${LOCAL_SUPABASE_URL}/auth/v1/**`, async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    const requestBody = request.postDataJSON() as Record<string, unknown> | null;
    const response = respond(pathname, requestBody ?? {}, request.method());
    await route.fulfill({
      status: response.status,
      contentType: "application/json",
      headers: { "x-supabase-api-version": "2024-01-01" },
      body: JSON.stringify(response.body),
    });
  });
}

test("demo entry opens the isolated account route and explains missing local configuration", async ({
  page,
}) => {
  test.skip(
    hasSupabaseConfiguration,
    "This case verifies the intentionally unconfigured /account mode.",
  );

  await page.goto("/");
  const accountLink = page
    .getByRole("navigation", { name: "Основная навигация" })
    .getByRole("link", { name: "Рабочий аккаунт" });
  if (!(await accountLink.isVisible())) {
    await page.getByRole("button", { name: "Меню" }).click();
  }
  await accountLink.click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(
    page.getByRole("heading", { name: "Подключите тестовый Supabase" }),
  ).toBeVisible();
  await expect(page.getByText("VITE_SUPABASE_URL", { exact: false })).toBeVisible();
  await expect(
    page.getByText("VITE_SUPABASE_PUBLISHABLE_KEY", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText(/service-role или secret key/)).toBeVisible();
  await expect(page.getByLabel("Выбор демонстрационной роли")).toHaveCount(0);
  await expect(page.getByText(/Демонстрационный режим/)).toHaveCount(0);
});

test("registration shows email-confirmation guidance and does not enter a workspace", async ({
  page,
}) => {
  test.skip(
    !usesLocalAuthMock,
    "Build with the local Playwright Supabase URL and the non-secret test key to exercise mocked auth.",
  );

  let submittedBody: Record<string, unknown> | null = null;
  await mockAuthEndpoint(page, (pathname, requestBody) => {
    if (pathname.endsWith("/auth/v1/signup")) {
      submittedBody = requestBody;
      return {
        status: 200,
        body: {
          user: {
            id: "00000000-0000-4000-8000-000000000001",
            aud: "authenticated",
            role: "authenticated",
            email: requestBody.email,
            app_metadata: { provider: "email", providers: ["email"] },
            user_metadata: {},
            identities: [],
          },
          session: null,
        },
      };
    }
    return {
      status: 401,
      body: { code: "missing_authorization", message: "Missing authorization header" },
    };
  });

  await page.goto("/account");
  await expect(
    page.getByRole("heading", { name: "Вход в HoReCa Marketplace" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Создать аккаунт" }).click();
  await expect(page.getByRole("button", { name: "Создать аккаунт" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByLabel("Email").fill("e2e.account@example.test");
  await page.getByLabel("Пароль").fill("test-password-123");
  await page.getByRole("button", { name: "Зарегистрироваться" }).click();

  await expect(
    page.getByText(
      "Регистрация отправлена. Если подтверждение включено, проверьте почту.",
    ),
  ).toBeVisible();
  expect(submittedBody).toMatchObject({
    email: "e2e.account@example.test",
    password: "test-password-123",
  });
  await expect(page.getByRole("heading", { name: "Рабочее пространство" })).toHaveCount(
    0,
  );
});

test("sign-in failure is reported in safe, user-facing language", async ({ page }) => {
  test.skip(
    !usesLocalAuthMock,
    "Build with the local Playwright Supabase URL and the non-secret test key to exercise mocked auth.",
  );

  await mockAuthEndpoint(page, (pathname) => {
    if (pathname.endsWith("/auth/v1/token")) {
      return {
        status: 400,
        body: {
          code: "invalid_credentials",
          message: "Invalid login credentials",
          msg: "Invalid login credentials",
        },
      };
    }
    return {
      status: 401,
      body: { code: "missing_authorization", message: "Missing authorization header" },
    };
  });

  await page.goto("/account");
  await page.getByLabel("Email").fill("wrong.account@example.test");
  await page.getByLabel("Пароль").fill("wrong-password-123");
  await page.getByRole("button", { name: "Войти" }).last().click();

  await expect(
    page.getByText("Не удалось войти: проверьте email и пароль."),
  ).toBeVisible();
  await expect(page.getByText("Invalid login credentials")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Рабочее пространство" })).toHaveCount(
    0,
  );
});

const mockUser = {
  id: "00000000-0000-4000-8000-000000000002",
  aud: "authenticated",
  role: "authenticated",
  email: "e2e.recovery@example.test",
  app_metadata: { provider: "email", providers: ["email"] },
  user_metadata: {},
  identities: [],
  email_confirmed_at: "2026-11-24T00:00:00.000Z",
};

function mockSession() {
  return {
    access_token: "mock-access-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "mock-refresh-token",
    user: mockUser,
  };
}

test("password recovery request never reveals whether an account exists", async ({
  page,
}) => {
  test.skip(!usesLocalAuthMock, "Runs only with the local mocked Supabase build.");
  let recoveryEmail: unknown = null;
  await mockAuthEndpoint(page, (pathname, requestBody) => {
    if (pathname.endsWith("/auth/v1/recover")) {
      recoveryEmail = requestBody.email;
      return { status: 200, body: {} };
    }
    return {
      status: 401,
      body: { code: "missing_authorization", message: "Missing authorization header" },
    };
  });

  await page.goto("/account");
  await page.getByRole("button", { name: "Забыли пароль?" }).click();
  await expect(page.getByRole("button", { name: "Отправить ссылку" })).toBeVisible();
  await page.getByLabel("Email").fill("unknown.account@example.test");
  await page.getByRole("button", { name: "Отправить ссылку" }).click();

  await expect(
    page.getByText(
      "Если адрес зарегистрирован, отправим ссылку для восстановления доступа. Мы не сообщаем, существует ли аккаунт.",
    ),
  ).toBeVisible();
  expect(recoveryEmail).toBe("unknown.account@example.test");
  await expect(page.getByRole("heading", { name: "Рабочее пространство" })).toHaveCount(
    0,
  );
});

test("signed-in buyer signs out through Supabase Auth", async ({ page }) => {
  test.skip(!usesLocalAuthMock, "Runs only with the local mocked Supabase build.");
  let loggedOut = false;
  await mockAuthEndpoint(page, (pathname, _body, method) => {
    if (pathname.endsWith("/auth/v1/token") && method === "POST") {
      return { status: 200, body: mockSession() };
    }
    if (pathname.endsWith("/auth/v1/user") && method === "GET") {
      return { status: 200, body: mockUser };
    }
    if (pathname.endsWith("/auth/v1/logout")) {
      loggedOut = true;
      return { status: 204, body: {} };
    }
    return {
      status: 401,
      body: { code: "missing_authorization", message: "Missing authorization header" },
    };
  });
  await page.route(`${LOCAL_SUPABASE_URL}/rest/v1/**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "content-range": "0-0/0", "x-supabase-api-version": "2024-01-01" },
      body: "[]",
    });
  });

  await page.goto("/account");
  await page.getByLabel("Email").fill(mockUser.email);
  await page.getByLabel("Пароль").fill("test-password-123");
  await page.getByRole("button", { name: "Войти" }).last().click();
  await expect(page.getByRole("heading", { name: "Рабочее пространство" })).toBeVisible();

  await page.getByRole("button", { name: "Выйти" }).click();
  await expect(
    page.getByRole("heading", { name: "Вход в HoReCa Marketplace" }),
  ).toBeVisible();
  expect(loggedOut).toBe(true);
});

test("keyboard-only sign-in keeps focus order and announces a safe error", async ({
  page,
}) => {
  test.skip(!usesLocalAuthMock, "Runs only with the local mocked Supabase build.");
  await mockAuthEndpoint(page, (pathname) => {
    if (pathname.endsWith("/auth/v1/token")) {
      return {
        status: 400,
        body: { code: "invalid_credentials", message: "Invalid login credentials" },
      };
    }
    return {
      status: 401,
      body: { code: "missing_authorization", message: "Missing authorization header" },
    };
  });

  await page.goto("/account");
  const email = page.getByLabel("Email");
  await email.focus();
  await expect(email).toBeFocused();
  await page.keyboard.type("wrong.account@example.test");
  await page.keyboard.press("Tab");
  const password = page.getByLabel("Пароль");
  await expect(password).toBeFocused();
  await page.keyboard.type("wrong-password-123");
  await page.keyboard.press("Tab");
  const submit = page.getByRole("button", { name: "Войти" }).last();
  await expect(submit).toBeFocused();
  await page.keyboard.press("Enter");

  const alert = page.getByRole("alert");
  await expect(alert).toContainText("Не удалось войти: проверьте email и пароль.");
  expect(await alert.getAttribute("role")).toBe("alert");
  await expect
    .poll(async () => page.evaluate(() => document.activeElement?.tagName ?? ""))
    .toBe("BUTTON");
});
