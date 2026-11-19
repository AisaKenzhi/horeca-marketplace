import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { AppProvider, createRepository } from "@/app/store";
import { App } from "@/app/App";

function renderApp() {
  return render(
    <MemoryRouter initialEntries={["/catalog"]}>
      <AppProvider repository={createRepository()}>
        <App />
      </AppProvider>
    </MemoryRouter>,
  );
}

describe("buyer catalog UI", () => {
  it("shows the demo banner and a supplier for each offer", async () => {
    renderApp();
    expect(screen.getAllByText(/Демонстрационный режим/).length).toBeGreaterThan(0);
    expect(await screen.findByText(/Мука пшеничная в\/с/)).toBeInTheDocument();
    // The seller is always visible next to the offer.
    expect(screen.getAllByText(/Поставщик «Альфа» \(демо\)/).length).toBeGreaterThan(0);
  });

  it("shows an unknown price as 'не указано' rather than a number", async () => {
    renderApp();
    const row = (await screen.findByText(/Томатная паста 28%/)).closest("article");
    expect(row).not.toBeNull();
    expect(within(row as HTMLElement).getAllByText(/не указано/i).length).toBeGreaterThan(
      0,
    );
  });

  it("marks a stale price with a stale badge", async () => {
    renderApp();
    const row = (await screen.findByText(/устаревшая цена/)).closest("article");
    expect(within(row as HTMLElement).getAllByText(/устарело/i).length).toBeGreaterThan(
      0,
    );
  });

  it("adds an item to the basket", async () => {
    const user = userEvent.setup();
    renderApp();
    const row = (await screen.findByText(/Мука пшеничная в\/с/)).closest("article")!;
    await user.click(within(row).getByRole("button", { name: "В корзину" }));
    expect(await screen.findByText(/добавлена в корзину/i)).toBeInTheDocument();
  });
});
