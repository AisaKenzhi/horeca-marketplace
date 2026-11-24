import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import {
  AccountConfigurationNotice,
  AccountPasswordUpdate,
} from "@/features/account/AccountWorkspace";
import { CatalogOfferTermsForm } from "@/features/account/CatalogOfferTermsForm";
import { App } from "@/app/App";
import { AppProvider } from "@/app/store";

function renderAccountRoute() {
  return render(
    <MemoryRouter initialEntries={["/account"]}>
      <AppProvider>
        <App />
      </AppProvider>
    </MemoryRouter>,
  );
}

function renderDemoRoute() {
  return render(
    <MemoryRouter initialEntries={["/catalog"]}>
      <AppProvider>
        <App />
      </AppProvider>
    </MemoryRouter>,
  );
}

describe("authenticated account vertical", () => {
  it("submits an explicit updated price, currency, and availability", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <CatalogOfferTermsForm
        offerId="offer-1"
        priceAmount={12}
        currency="EUR"
        availability="unknown"
        busy={false}
        onUpdate={onUpdate}
      />,
    );

    await user.click(screen.getByText("Изменить цену и наличие"));
    await user.clear(screen.getByLabelText("Цена за продаваемую единицу"));
    await user.type(screen.getByLabelText("Цена за продаваемую единицу"), "18.75");
    await user.clear(screen.getByLabelText("Код валюты"));
    await user.type(screen.getByLabelText("Код валюты"), "kzt");
    await user.selectOptions(screen.getByLabelText("Доступность"), "low_stock");
    await user.click(screen.getByRole("button", { name: "Сохранить изменения" }));

    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith({
        priceAmount: 18.75,
        currency: "KZT",
        availability: "low_stock",
      }),
    );
  });

  it("rejects a price edit without an explicit currency", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(undefined);
    render(
      <CatalogOfferTermsForm
        offerId="offer-2"
        priceAmount={12}
        currency="EUR"
        availability="in_stock"
        busy={false}
        onUpdate={onUpdate}
      />,
    );

    await user.click(screen.getByText("Изменить цену и наличие"));
    await user.clear(screen.getByLabelText("Код валюты"));
    await user.click(screen.getByRole("button", { name: "Сохранить изменения" }));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(await screen.findByText(/трёхбуквенный код валюты/)).toBeInTheDocument();
  });

  it("saves a new password only through the explicit auth boundary", async () => {
    const user = userEvent.setup();
    const onUpdatePassword = vi.fn().mockResolvedValue(undefined);
    const onDone = vi.fn();
    render(<AccountPasswordUpdate onUpdatePassword={onUpdatePassword} onDone={onDone} />);

    await user.type(
      screen.getByLabelText("Новый пароль", { selector: "input" }),
      "new-password-123",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить новый пароль" }));

    await waitFor(() =>
      expect(onUpdatePassword).toHaveBeenCalledWith("new-password-123"),
    );
    expect(
      screen.getByText("Пароль обновлён. Используйте его при следующем входе."),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Перейти в рабочее пространство" }),
    );
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("reports an auth failure without exposing internal detail", async () => {
    const user = userEvent.setup();
    render(
      <AccountPasswordUpdate
        onUpdatePassword={vi.fn().mockRejectedValue(new Error("internal token detail"))}
        onDone={vi.fn()}
      />,
    );

    await user.type(
      screen.getByLabelText("Новый пароль", { selector: "input" }),
      "new-password-123",
    );
    await user.click(screen.getByRole("button", { name: "Сохранить новый пароль" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Не удалось выполнить запрос. Проверьте данные и попробуйте позже.",
    );
    expect(screen.queryByText("internal token detail")).not.toBeInTheDocument();
  });

  it("explains the explicit public-key configuration without exposing a service key", () => {
    render(<AccountConfigurationNotice />);
    expect(
      screen.getByRole("heading", { name: "Подключите тестовый Supabase" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/VITE_SUPABASE_PUBLISHABLE_KEY/)).toBeInTheDocument();
    expect(screen.getByText(/service-role или secret key/)).toBeInTheDocument();
  });

  it("renders the /account route without demo banners or persona controls", async () => {
    renderAccountRoute();
    expect(
      await screen.findByRole("heading", { name: "Подключите тестовый Supabase" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Демонстрационный режим/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/демо-персона/i)).not.toBeInTheDocument();
  });

  it("keeps synthetic demo routes available alongside /account", () => {
    renderDemoRoute();
    expect(screen.getByText(/Демонстрационный режим/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Рабочий аккаунт" })).toHaveAttribute(
      "href",
      "/account",
    );
    expect(screen.getByRole("heading", { name: /Каталог/ })).toBeInTheDocument();
  });
});
