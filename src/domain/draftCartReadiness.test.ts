import { describe, expect, it } from "vitest";
import {
  formatCurrencyMinor,
  reviewDraftCart,
  type DraftCartInput,
  type DraftCartLocationInput,
  type DraftCartOfferInput,
  type DraftCartSupplierInput,
} from "./draftCartReadiness";

const organizationId = "buyer-a";
const nowIso = "2026-11-24T00:00:00.000Z";
const location: DraftCartLocationInput = {
  id: "location-a",
  organization_id: organizationId,
  name: "Warsaw kitchen",
  delivery_zone: "Warsaw",
};
const supplier: DraftCartSupplierInput = {
  organization_id: "supplier-a",
  display_name: "Fresh Foods",
  verification_status: "approved",
};

function offer(overrides: Partial<DraftCartOfferInput> = {}): DraftCartOfferInput {
  return {
    id: "offer-a",
    supplier_organization_id: supplier.organization_id,
    title: "Flour",
    sell_unit_label: "bag",
    price_amount: 12.5,
    currency: "KZT",
    moq: 2,
    order_step: 2,
    availability: "in_stock",
    price_valid_until: "2026-11-25T00:00:00.000Z",
    is_published: true,
    price_observed_at: "2026-11-23T12:00:00.000Z",
    availability_observed_at: "2026-11-23T12:00:00.000Z",
    version: 1,
    ...overrides,
  };
}

function cart(overrides: Partial<DraftCartInput> = {}): DraftCartInput {
  return {
    id: "cart-a",
    organization_id: organizationId,
    buyer_location_id: location.id,
    items: [
      {
        id: "item-a",
        catalog_offer_id: "offer-a",
        quantity: 2,
        catalog_offer_version: 1,
      },
    ],
    ...overrides,
  };
}

function review(
  input: {
    readonly cart?: DraftCartInput;
    readonly locations?: readonly DraftCartLocationInput[];
    readonly offers?: readonly DraftCartOfferInput[];
    readonly suppliers?: readonly DraftCartSupplierInput[];
    readonly currentOrganizationId?: string;
  } = {},
) {
  return reviewDraftCart({
    organizationId: input.currentOrganizationId ?? organizationId,
    cart: input.cart ?? cart(),
    locations: input.locations ?? [location],
    offers: input.offers ?? [offer()],
    suppliers: input.suppliers ?? [supplier],
    nowIso,
  });
}

describe("reviewDraftCart", () => {
  it("passes supported checks and shows an exact supplier subtotal without creating an order", () => {
    const secondOffer = offer({
      id: "offer-b",
      title: "Oil",
      price_amount: 7.75,
    });
    const result = review({
      offers: [offer(), secondOffer],
      cart: cart({
        items: [
          {
            id: "item-a",
            catalog_offer_id: "offer-a",
            quantity: 2,
            catalog_offer_version: 1,
          },
          {
            id: "item-b",
            catalog_offer_id: "offer-b",
            quantity: 4,
            catalog_offer_version: 1,
          },
        ],
      }),
    });

    expect(result.readyForCurrentChecks).toBe(true);
    expect(result.locationName).toBe("Warsaw kitchen");
    expect(result.supplierGroups).toHaveLength(1);
    expect(result.supplierGroups[0]?.subtotalCurrency).toBe("KZT");
    expect(result.supplierGroups[0]?.subtotalMinor).toBe(5_600n);
    expect(formatCurrencyMinor(5_600n, "KZT")).toContain("56");
    expect(result.coverageWarning).toContain("покрытие и доставка не подтверждены");
  });

  it("groups different suppliers separately and never creates a cart-wide subtotal", () => {
    const otherSupplier: DraftCartSupplierInput = {
      organization_id: "supplier-b",
      display_name: "Other supplier",
      verification_status: "approved",
    };
    const otherOffer = offer({
      id: "offer-b",
      supplier_organization_id: otherSupplier.organization_id,
      price_amount: 30,
    });
    const result = review({
      offers: [offer(), otherOffer],
      suppliers: [supplier, otherSupplier],
      cart: cart({
        items: [
          {
            id: "item-a",
            catalog_offer_id: "offer-a",
            quantity: 2,
            catalog_offer_version: 1,
          },
          {
            id: "item-b",
            catalog_offer_id: "offer-b",
            quantity: 2,
            catalog_offer_version: 1,
          },
        ],
      }),
    });

    expect(result.readyForCurrentChecks).toBe(true);
    expect(result.supplierGroups).toHaveLength(2);
    expect(result.supplierGroups.map((group) => group.subtotalMinor)).toEqual([
      2_500n,
      6_000n,
    ]);
    expect(result).not.toHaveProperty("subtotalMinor");
  });

  it("reports missing location, exact MOQ and step blockers, while retaining editable line context", () => {
    const result = review({
      cart: cart({
        buyer_location_id: null,
        items: [
          {
            id: "item-a",
            catalog_offer_id: "offer-a",
            quantity: 1,
            catalog_offer_version: 1,
          },
          {
            id: "item-b",
            catalog_offer_id: "offer-a",
            quantity: 3,
            catalog_offer_version: 1,
          },
        ],
      }),
    });

    expect(result.readyForCurrentChecks).toBe(false);
    expect(result.blockers).toContain(
      "Выберите точку покупателя для этой черновой корзины.",
    );
    expect(result.supplierGroups[0]?.lines[0]?.issues).toContain(
      "Минимальный заказ по позиции: 2.",
    );
    expect(result.supplierGroups[0]?.lines[1]?.issues).toContain(
      "Количество должно быть кратно шагу 2.",
    );
  });

  it("does not calculate a supplier subtotal for a non-integer quantity", () => {
    const result = review({
      cart: cart({
        items: [
          {
            id: "item-fractional",
            catalog_offer_id: "offer-a",
            quantity: 2.5,
            catalog_offer_version: 1,
          },
        ],
      }),
    });

    expect(result.readyForCurrentChecks).toBe(false);
    expect(result.supplierGroups[0]?.lines[0]?.issues).toContain(
      "Количество должно быть целым положительным числом.",
    );
    expect(result.supplierGroups[0]?.lines[0]?.subtotalMinor).toBeNull();
  });

  it("blocks stale or expired prices, version drift, non-published offers and unconfirmed stock", () => {
    const staleOffer = offer({
      price_observed_at: "2026-11-22T00:00:00.000Z",
      price_valid_until: "2026-11-23T23:59:59.000Z",
      availability: "unknown",
    });
    const result = review({
      offers: [staleOffer],
      suppliers: [{ ...supplier, verification_status: "pending" }],
      cart: cart({
        items: [
          {
            id: "item-a",
            catalog_offer_id: staleOffer.id,
            quantity: 2,
            catalog_offer_version: 2,
          },
        ],
      }),
    });
    const issues = result.supplierGroups[0]?.lines[0]?.issues ?? [];

    expect(result.readyForCurrentChecks).toBe(false);
    expect(issues).toContain("Статус одобрения поставщика не подтверждён.");
    expect(issues).toContain(
      "Версия предложения изменилась: в корзине 2, сейчас 1; цену и условия нужно проверить заново.",
    );
    expect(issues).toContain(
      "Цена наблюдалась более 24 часов назад; нужна актуализация.",
    );
    expect(issues).toContain("Срок действия цены истёк; нужна новая цена.");
    expect(issues).toContain("Наличие не указано и не считается подтверждённым.");
    expect(result.supplierGroups[0]?.subtotalMinor).toBeNull();
  });

  it("does not calculate a supplier subtotal across unlike or missing currencies", () => {
    const euroOffer = offer({ id: "offer-eur", currency: "EUR" });
    const result = review({
      offers: [offer(), euroOffer],
      cart: cart({
        items: [
          {
            id: "item-a",
            catalog_offer_id: "offer-a",
            quantity: 2,
            catalog_offer_version: 1,
          },
          {
            id: "item-eur",
            catalog_offer_id: "offer-eur",
            quantity: 2,
            catalog_offer_version: 1,
          },
        ],
      }),
    });
    expect(result.supplierGroups[0]?.subtotalMinor).toBeNull();
    expect(result.supplierGroups[0]?.subtotalCurrency).toBeNull();
    expect(result.supplierGroups[0]?.subtotalNote).toContain("разные валюты");

    const unknownPrice = offer({ id: "offer-null", price_amount: null, currency: null });
    const missingPriceResult = review({
      offers: [offer(), unknownPrice],
      cart: cart({
        items: [
          {
            id: "item-a",
            catalog_offer_id: "offer-a",
            quantity: 2,
            catalog_offer_version: 1,
          },
          {
            id: "item-null",
            catalog_offer_id: "offer-null",
            quantity: 2,
            catalog_offer_version: 1,
          },
        ],
      }),
    });
    expect(missingPriceResult.supplierGroups[0]?.subtotalMinor).toBeNull();
    expect(missingPriceResult.supplierGroups[0]?.subtotalNote).toContain(
      "непроверенная или отсутствующая цена",
    );
  });

  it("does not expose or evaluate a cart whose organization does not match the active tenant", () => {
    const result = review({
      currentOrganizationId: "buyer-other",
      cart: cart({
        organization_id: "buyer-a",
        items: [
          {
            id: "secret-line",
            catalog_offer_id: "offer-a",
            quantity: 2,
            catalog_offer_version: 1,
          },
        ],
      }),
    });
    expect(result.scopeMismatch).toBe(true);
    expect(result.supplierGroups).toEqual([]);
    expect(result.blockers).toEqual(["Черновая корзина недоступна в этой организации."]);
  });

  it("blocks an unpublished offer and does not show its supplier subtotal", () => {
    const unpublishedOffer = offer({ is_published: false });
    const result = review({ offers: [unpublishedOffer] });

    expect(result.readyForCurrentChecks).toBe(false);
    expect(result.supplierGroups[0]?.lines[0]?.issues).toContain(
      "Предложение снято с публикации.",
    );
    expect(result.supplierGroups[0]?.subtotalMinor).toBeNull();
  });

  it("rejects a location that belongs to another organization", () => {
    const result = review({
      locations: [{ ...location, organization_id: "buyer-other" }],
    });
    expect(result.readyForCurrentChecks).toBe(false);
    expect(result.locationName).toBeNull();
    expect(result.locationIssues).toEqual([
      "Выбранная точка не найдена среди точек этой организации.",
    ]);
  });
});
