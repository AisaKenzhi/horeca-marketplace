import { describe, expect, it } from "vitest";
import type { CatalogOfferDraft } from "@/data/supabase/workspace";
import {
  validateBuyerLocation,
  validateCatalogOffer,
  validateOrganizationName,
} from "@/data/supabase/validation";

const validOffer: CatalogOfferDraft = {
  supplierSku: "SKU-100",
  title: "Tomato paste",
  category: "Grocery",
  sellUnitLabel: "case",
  unitsPerSellUnit: 1,
  packAmount: 4.5,
  packBaseUnit: "kg",
  priceAmount: 12.3456,
  currency: "EUR",
  moq: 2,
  orderStep: 1,
  availability: "unknown",
};

describe("authenticated workspace input validation", () => {
  it("accepts a trimmed organization name within database limits", () => {
    expect(validateOrganizationName("  Warsaw Kitchen  ")).toBeNull();
    expect(validateOrganizationName(" ")).not.toBeNull();
    expect(validateOrganizationName("x".repeat(121))).not.toBeNull();
  });

  it("requires a buyer location name and address but not a delivery-zone assumption", () => {
    expect(
      validateBuyerLocation({ name: "Main", address: "Warsaw", deliveryZone: "" }),
    ).toBeNull();
    expect(
      validateBuyerLocation({ name: "Main", address: " ", deliveryZone: "" }),
    ).not.toBeNull();
  });

  it("accepts explicit currency/price and rejects a currency without a price", () => {
    expect(validateCatalogOffer(validOffer)).toBeNull();
    expect(
      validateCatalogOffer({ ...validOffer, priceAmount: null, currency: "EUR" }),
    ).not.toBeNull();
    expect(validateCatalogOffer({ ...validOffer, priceAmount: 0 })).not.toBeNull();
  });

  it("requires safe integer order quantities and bounded packaging values", () => {
    expect(validateCatalogOffer({ ...validOffer, moq: 1.5 })).not.toBeNull();
    expect(
      validateCatalogOffer({ ...validOffer, packAmount: Number.POSITIVE_INFINITY }),
    ).not.toBeNull();
  });

  it("requires a three-letter currency code when price is supplied", () => {
    expect(validateCatalogOffer({ ...validOffer, currency: "PL" })).not.toBeNull();
    expect(validateCatalogOffer({ ...validOffer, currency: "pln" })).not.toBeNull();
  });
});
