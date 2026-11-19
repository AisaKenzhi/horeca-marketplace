import { describe, expect, it } from "vitest";
import {
  baseUnitsPerSellUnit,
  checkOrderQuantity,
  compareUnitPrices,
  isValidPackaging,
  unitPrice,
  type PackagingSpec,
} from "@/domain/packaging";

const box12x05: PackagingSpec = {
  sellUnit: {
    label: "ящик 12 × 0,5 л",
    unitsPerSellUnit: 12,
    packSize: { amount: 0.5, baseUnit: "l" },
  },
  moq: 2,
  orderStep: 1,
};

describe("packaging", () => {
  it("computes base units per sell unit", () => {
    expect(baseUnitsPerSellUnit(box12x05.sellUnit)).toBeCloseTo(6);
  });

  it("validates a well-formed spec", () => {
    expect(isValidPackaging(box12x05)).toBe(true);
  });

  it("rejects invalid MOQ / step", () => {
    expect(isValidPackaging({ ...box12x05, moq: 0 })).toBe(false);
    expect(isValidPackaging({ ...box12x05, orderStep: 0 })).toBe(false);
  });

  describe("checkOrderQuantity", () => {
    it("rejects non-positive and non-integer quantities", () => {
      expect(checkOrderQuantity(0, box12x05).ok).toBe(false);
      expect(checkOrderQuantity(-1, box12x05).ok).toBe(false);
      expect(checkOrderQuantity(1.5, box12x05).ok).toBe(false);
    });

    it("enforces MOQ with an explanatory reason", () => {
      const r = checkOrderQuantity(1, box12x05);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("below_moq");
    });

    it("enforces the order step multiple", () => {
      const step5: PackagingSpec = { ...box12x05, moq: 5, orderStep: 5 };
      const r = checkOrderQuantity(7, step5);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reason).toBe("not_step_multiple");
      expect(checkOrderQuantity(10, step5).ok).toBe(true);
    });
  });

  describe("unit price comparison", () => {
    it("computes price per base unit for a compatible pack", () => {
      // 6000 KZT per 6 L box = 1000 KZT/L
      const u = unitPrice(6000, box12x05.sellUnit);
      expect(u.comparable).toBe(true);
      if (u.comparable) {
        expect(u.baseUnit).toBe("l");
        expect(u.perBaseUnitMinor).toBe(1000);
        expect(u.exactlyDivisible).toBe(true);
      }
    });

    it("does not compare across incompatible base units", () => {
      const kgOffer = {
        pricePerSellUnitMinor: 5000,
        sellUnit: {
          label: "мешок 5 кг",
          unitsPerSellUnit: 1,
          packSize: { amount: 5, baseUnit: "kg" as const },
        },
      };
      const result = compareUnitPrices(
        { pricePerSellUnitMinor: 6000, sellUnit: box12x05.sellUnit },
        kgOffer,
      );
      expect(result.comparable).toBe(false);
    });

    it("marks the cheaper compatible offer", () => {
      const cheap = {
        pricePerSellUnitMinor: 5000,
        sellUnit: {
          label: "бут. 1 л",
          unitsPerSellUnit: 1,
          packSize: { amount: 1, baseUnit: "l" as const },
        },
      };
      const pricey = {
        pricePerSellUnitMinor: 6000,
        sellUnit: {
          label: "бут. 1 л",
          unitsPerSellUnit: 1,
          packSize: { amount: 1, baseUnit: "l" as const },
        },
      };
      expect(compareUnitPrices(cheap, pricey)).toMatchObject({
        comparable: true,
        cheaper: "a",
      });
      expect(compareUnitPrices(pricey, cheap)).toMatchObject({
        comparable: true,
        cheaper: "b",
      });
    });
  });
});
