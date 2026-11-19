/**
 * Reorder behaviour.
 *
 * A repeat purchase creates a NEW draft and re-checks current price and
 * availability. It must NOT reproduce old terms as if they were current, and
 * must NOT auto-submit. Missing offers are flagged, never silently dropped or
 * replaced.
 */

import type { BasketLine, SupplierOffer } from "./entities";
import { asBasketLineId, asIso } from "./ids";

export interface ReorderCandidate {
  readonly offerId: string;
  readonly supplierId: string;
  readonly title: string;
  readonly requestedQuantity: number;
  /** Live offer, or null if it no longer exists. */
  readonly liveOffer: SupplierOffer | null;
}

export type ReorderLineResult =
  | {
      readonly kind: "carried";
      readonly line: BasketLine;
      /** UI must re-check price/availability before this draft is usable. */
      readonly note: "price_recheck_needed";
    }
  | {
      readonly kind: "flagged";
      readonly candidate: ReorderCandidate;
      readonly reason: "offer_missing" | "offer_archived" | "price_unavailable";
    };

export interface ReorderDraft {
  readonly lines: readonly ReorderLineResult[];
  readonly flagged: readonly ReorderLineResult[];
  readonly summary: { carried: number; flagged: number };
}

/**
 * Build a reorder draft. Every carried line gets a snapshot of the CURRENT
 * price — the old price from history is never reused as a live value. Flagged
 * items are surfaced for the buyer to resolve; they are not removed.
 */
export function buildReorderDraft(
  candidates: readonly ReorderCandidate[],
  nowIso: string,
  newLineId: (n: number) => string = (n) => `reorder-line-${n}`,
): ReorderDraft {
  const lines: ReorderLineResult[] = [];
  candidates.forEach((c, index) => {
    const live = c.liveOffer;
    if (live === null) {
      lines.push({ kind: "flagged", candidate: c, reason: "offer_missing" });
      return;
    }
    if (live.archived) {
      lines.push({ kind: "flagged", candidate: c, reason: "offer_archived" });
      return;
    }
    if (live.pricePerSellUnit.value === null) {
      lines.push({ kind: "flagged", candidate: c, reason: "price_unavailable" });
      return;
    }
    lines.push({
      kind: "carried",
      note: "price_recheck_needed",
      line: {
        id: asBasketLineId(newLineId(index + 1)),
        offerId: live.id,
        supplierId: live.supplierId,
        quantity: c.requestedQuantity,
        // Snapshot of the CURRENT price so a later change shows as a delta.
        addedAtPriceSnapshot: live.pricePerSellUnit.value,
        addedAt: asIso(nowIso),
      },
    });
  });

  return {
    lines,
    flagged: lines.filter((l) => l.kind === "flagged"),
    summary: {
      carried: lines.filter((l) => l.kind === "carried").length,
      flagged: lines.filter((l) => l.kind === "flagged").length,
    },
  };
}

/** Human label for a flagged reorder line. */
export function describeFlaggedReason(
  reason: Extract<ReorderLineResult, { kind: "flagged" }>["reason"],
): string {
  switch (reason) {
    case "offer_missing":
      return "Предложение больше недоступно — нужно выбрать замену вручную.";
    case "offer_archived":
      return "Предложение снято с продажи — нужно подтвердить актуальность.";
    case "price_unavailable":
      return "Цена не указана — нужно запросить у поставщика.";
  }
}
