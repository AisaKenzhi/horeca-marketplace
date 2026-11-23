import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { AccountConfigurationNotice } from "@/features/account/AccountWorkspace";
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

describe("authenticated account vertical", () => {
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
});
