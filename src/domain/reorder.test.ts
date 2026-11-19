import { describe, expect, it } from "vitest";
import { buildReorderDraft, describeFlaggedReason } from "@/domain/reorder";
import { money } from "@/domain/money";
import {
  NOW,
  offerAlphaFlour,
  offerAlphaStale,
  offerBetaUnknownPrice,
} from "../../tests/fixtures";
import type { SupplierOffer } from "@/domain/entities";

const archived: SupplierOffer = { ...offerAlphaFlour, archived: true };

describe("reorder", () => {
  it("carries a valid line with a snapshot of the CURRENT price", () => {
    const draft = buildReorderDraft(
      [
        {
          offerId: offerAlphaFlour.id,
          supplierId: offerAlphaFlour.supplierId,
          title: offerAlphaFlour.title,
          requestedQuantity: 2,
          liveOffer: {
            ...offerAlphaFlour,
            pricePerSellUnit: { value: money(3400), observedAt: NOW },
          },
        },
      ],
      NOW,
    );
    expect(draft.summary.carried).toBe(1);
    const carried = draft.lines[0]!;
    expect(carried.kind).toBe("carried");
    if (carried.kind === "carried") {
      // Uses the current 3400, not the historical 3200.
      expect(carried.line.addedAtPriceSnapshot?.amount).toBe(3400);
      expect(carried.note).toBe("price_recheck_needed");
    }
  });

  it("flags a missing offer instead of dropping it", () => {
    const draft = buildReorderDraft(
      [
        {
          offerId: "gone",
          supplierId: "s",
          title: "x",
          requestedQuantity: 1,
          liveOffer: null,
        },
      ],
      NOW,
    );
    expect(draft.summary.flagged).toBe(1);
    const flagged = draft.lines[0]!;
    if (flagged.kind === "flagged") {
      expect(flagged.reason).toBe("offer_missing");
      expect(describeFlaggedReason(flagged.reason)).toMatch(/недоступно/);
    } else {
      throw new Error("expected flagged");
    }
  });

  it("flags an archived offer", () => {
    const draft = buildReorderDraft(
      [
        {
          offerId: archived.id,
          supplierId: archived.supplierId,
          title: archived.title,
          requestedQuantity: 2,
          liveOffer: archived,
        },
      ],
      NOW,
    );
    expect(draft.summary.flagged).toBe(1);
  });

  it("flags an offer with no available price", () => {
    const draft = buildReorderDraft(
      [
        {
          offerId: offerBetaUnknownPrice.id,
          supplierId: offerBetaUnknownPrice.supplierId,
          title: offerBetaUnknownPrice.title,
          requestedQuantity: 6,
          liveOffer: offerBetaUnknownPrice,
        },
      ],
      NOW,
    );
    const flagged = draft.lines[0]!;
    if (flagged.kind === "flagged") expect(flagged.reason).toBe("price_unavailable");
  });

  it("never auto-submits: the output is only draft lines", () => {
    const draft = buildReorderDraft(
      [
        {
          offerId: offerAlphaStale.id,
          supplierId: offerAlphaStale.supplierId,
          title: offerAlphaStale.title,
          requestedQuantity: 1,
          liveOffer: offerAlphaStale,
        },
      ],
      NOW,
    );
    // There is no 'submitted' or 'order' field anywhere in the draft shape.
    expect(Object.keys(draft)).toEqual(["lines", "flagged", "summary"]);
  });
});
