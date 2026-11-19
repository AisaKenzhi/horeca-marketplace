import { describe, expect, it } from "vitest";
import { computeCart, computeLine, priceDelta } from "@/domain/cart";
import { money } from "@/domain/money";
import {
  demoOffers,
  demoSuppliers,
  makeBasket,
  makeBasketLine,
  offerAlphaFlour,
  offerAlphaStale,
  offerBetaOil,
  offerBetaUnknownPrice,
} from "../../tests/fixtures";

const offersById = new Map(demoOffers.map((o) => [o.id as string, o]));
const suppliersById = new Map(demoSuppliers.map((s) => [s.id as string, s]));

function cart(lines: Parameters<typeof makeBasket>[0]) {
  return computeCart(makeBasket(lines), offersById, suppliersById);
}

describe("cart -> supplier suborders", () => {
  it("splits a mixed basket into one group per supplier", () => {
    const result = cart([
      makeBasketLine("l1", offerAlphaFlour, 2),
      makeBasketLine("l2", offerBetaOil, 6),
    ]);
    expect(result.supplierCount).toBe(2);
    expect(result.groups.map((g) => g.supplierId)).toEqual([
      offerAlphaFlour.supplierId,
      offerBetaOil.supplierId,
    ]);
  });

  it("computes per-line and per-supplier subtotals deterministically", () => {
    // 2 x 3200 = 6400
    const result = cart([makeBasketLine("l1", offerAlphaFlour, 2)]);
    const group = result.groups[0]!;
    expect(group.subtotal.amount).toBe(6400);
    expect(group.lines[0]!.subtotal.amount).toBe(6400);
  });

  it("never combines different suppliers into one bill", () => {
    const result = cart([
      makeBasketLine("l1", offerAlphaFlour, 2),
      makeBasketLine("l2", offerBetaOil, 6),
    ]);
    // Each group's subtotal is independent; grandSubtotal is informational only.
    const alpha = result.groups.find((g) => g.supplierId === offerAlphaFlour.supplierId)!;
    const beta = result.groups.find((g) => g.supplierId === offerBetaOil.supplierId)!;
    expect(alpha.subtotal.amount).toBe(6400);
    expect(beta.subtotal.amount).toBe(5400);
    expect(result.grandSubtotal.amount).toBe(11_800);
  });

  it("flags MOQ violations per line and blocks submission", () => {
    // Alpha flour MOQ is 2; order 1.
    const result = cart([makeBasketLine("l1", offerAlphaFlour, 1)]);
    const group = result.groups[0]!;
    expect(group.readyToSubmit).toBe(false);
    expect(group.lines[0]!.problem?.kind).toBe("quantity");
  });

  it("flags order-step violations", () => {
    // Alpha flour step is 2; order 3 (>= moq 2 but not a multiple of 2).
    const result = cart([makeBasketLine("l1", offerAlphaFlour, 3)]);
    expect(result.groups[0]!.lines[0]!.problem?.kind).toBe("quantity");
  });

  it("reports the exact amount missing to reach the supplier minimum", () => {
    // Alpha minimum is 15000; one line of 2 x 3200 = 6400 => short by 8600.
    const result = cart([makeBasketLine("l1", offerAlphaFlour, 2)]);
    const group = result.groups[0]!;
    expect(group.minimumMet).toBe(false);
    expect(group.amountToMinimum.amount).toBe(8600);
  });

  it("marks the minimum met once reached", () => {
    // 5 x 3200 = 16000 >= 15000
    const result = cart([makeBasketLine("l1", offerAlphaFlour, 6)]);
    const group = result.groups[0]!;
    expect(group.minimumMet).toBe(true);
    expect(group.subtotal.amount).toBe(19_200);
  });

  it("keeps an UNKNOWN delivery cost separate and never as zero", () => {
    // Beta has deliveryFee = null.
    const result = cart([makeBasketLine("l2", offerBetaOil, 6)]);
    const group = result.groups[0]!;
    expect(group.delivery.known).toBe(false);
    expect(group.hasUnknownDelivery).toBe(true);
    expect(result.anyUnknownDelivery).toBe(true);
    // Total equals subtotal only because a fee is excluded, not zeroed.
    expect(group.total.amount).toBe(group.subtotal.amount);
    // And we do not add it to the known-delivery total.
    expect(result.knownDeliveryTotal.amount).toBe(0);
  });

  it("waives delivery exactly at the free-delivery threshold", () => {
    // Alpha threshold 50000. 16 x 3200 = 51200 => free.
    const result = cart([makeBasketLine("l1", offerAlphaFlour, 16)]);
    const group = result.groups[0]!;
    expect(group.delivery.known).toBe(true);
    if (group.delivery.known) {
      expect(group.delivery.freeBecauseThresholdMet).toBe(true);
      expect(group.delivery.fee.amount).toBe(0);
    }
  });

  it("charges delivery below the threshold", () => {
    const result = cart([makeBasketLine("l1", offerAlphaFlour, 6)]);
    const group = result.groups[0]!;
    if (group.delivery.known) {
      expect(group.delivery.fee.amount).toBe(2500);
      expect(group.total.amount).toBe(19_200 + 2500);
    } else {
      throw new Error("expected known delivery for Alpha");
    }
  });

  it("surfaces unknown price as a blocker, not as zero", () => {
    const result = cart([makeBasketLine("l3", offerBetaUnknownPrice, 6)]);
    const group = result.groups[0]!;
    expect(group.lines[0]!.problem?.kind).toBe("price_unknown");
    expect(group.lines[0]!.subtotal.amount).toBe(0);
    expect(group.readyToSubmit).toBe(false);
  });

  it("uses the live price, not a stale snapshot, for subtotals", () => {
    const line = makeBasketLine("l1", offerAlphaFlour, 2);
    const computed = computeLine(line, offerAlphaFlour);
    expect(computed.subtotal.amount).toBe(6400);
  });

  it("detects a price delta between snapshot and live offer", () => {
    const line = makeBasketLine("l1", offerAlphaFlour, 2);
    const changed = {
      ...offerAlphaFlour,
      pricePerSellUnit: { value: money(3500), observedAt: line.addedAt },
    };
    const delta = priceDelta(line, changed);
    expect(delta.note).toBe("changed");
    expect(delta.changed).toBe(true);
    expect(delta.before?.amount).toBe(3200);
    expect(delta.after?.amount).toBe(3500);
  });

  it("reports unchanged when the live price matches the snapshot", () => {
    const line = makeBasketLine("l1", offerAlphaFlour, 2);
    expect(priceDelta(line, offerAlphaFlour).note).toBe("unchanged");
  });

  it("keeps a stale-price line usable but exposes its timestamp via freshness elsewhere", () => {
    // Stale price is still a known price (not null); freshness UI labels it.
    const result = cart([makeBasketLine("ls", offerAlphaStale, 1)]);
    const group = result.groups[0]!;
    expect(group.lines[0]!.problem).toBeNull();
    expect(group.lines[0]!.subtotal.amount).toBe(28_000);
  });
});
