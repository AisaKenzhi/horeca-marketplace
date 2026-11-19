/**
 * Cart grouping and per-supplier totals.
 *
 * A basket may hold offers from several suppliers for convenience, but it is
 * ALWAYS split into independent supplier suborders, each with its own
 * conditions, minimums and states. We never present a single "cart total" as
 * one bill or one payment.
 */

import type { Basket, BasketLine, SupplierOffer, SupplierProfile } from "./entities";
import {
  formatMoney,
  isZeroMoney,
  money,
  multiplyMoney,
  subMoney,
  sumMoney,
  zero,
  type Money,
} from "./money";
import { checkOrderQuantity, type QuantityProblem } from "./packaging";

export interface ComputedLine {
  readonly line: BasketLine;
  readonly offer: SupplierOffer;
  /** Deterministic line subtotal: quantity x price per sell unit. */
  readonly subtotal: Money;
  /** Set when the live price is unavailable or the offer is archived. */
  readonly problem: LineProblem | null;
}

export type LineProblem =
  | { kind: "quantity"; reason: QuantityProblem; message: string }
  | { kind: "archived" }
  | { kind: "price_unknown" }
  | { kind: "price_stale"; lastKnown: Money };

export interface UnknownDelivery {
  readonly known: false;
  readonly reason: "not_stated";
}

export interface KnownDelivery {
  readonly known: true;
  readonly fee: Money;
  /** True when the threshold was met and the fee is waived. */
  readonly freeBecauseThresholdMet: boolean;
}

export interface SuborderGroup {
  readonly supplierId: SupplierProfile["id"];
  readonly supplier: SupplierProfile;
  readonly lines: readonly ComputedLine[];
  /** Sum of line subtotals for this supplier only. */
  readonly subtotal: Money;
  readonly minimumOrderValue: Money;
  readonly minimumMet: boolean;
  readonly amountToMinimum: Money;
  readonly delivery: KnownDelivery | UnknownDelivery;
  /** Total = subtotal + known delivery. When delivery is unknown we keep it separate. */
  readonly total: Money;
  readonly hasUnknownDelivery: boolean;
  /** True only when every line is valid and the supplier minimum is met. */
  readonly readyToSubmit: boolean;
  readonly blockers: readonly string[];
}

export interface CartComputation {
  readonly groups: readonly SuborderGroup[];
  /** Number of distinct suppliers. Never shown as a single combined bill. */
  readonly supplierCount: number;
  /** Gross subtotal across suppliers for information only. */
  readonly grandSubtotal: Money;
  /** Sum of only the KNOWN delivery fees. Unknown fees are excluded, not zeroed. */
  readonly knownDeliveryTotal: Money;
  /** True when any supplier's delivery is unknown; totals are then provisional. */
  readonly anyUnknownDelivery: boolean;
}

function priceOf(offer: SupplierOffer): Money | null {
  return offer.pricePerSellUnit.value;
}

export function computeLine(line: BasketLine, offer: SupplierOffer): ComputedLine {
  if (offer.archived) {
    return { line, offer, subtotal: zero(), problem: { kind: "archived" } };
  }
  const price = priceOf(offer);
  if (price === null) {
    return { line, offer, subtotal: zero(), problem: { kind: "price_unknown" } };
  }
  const qtyCheck = checkOrderQuantity(line.quantity, offer.packaging);
  if (!qtyCheck.ok) {
    return {
      line,
      offer,
      subtotal: zero(),
      problem: { kind: "quantity", reason: qtyCheck.reason, message: qtyCheck.message },
    };
  }
  return { line, offer, subtotal: multiplyMoney(price, line.quantity), problem: null };
}

export function computeSuborderGroup(
  supplier: SupplierProfile,
  lines: readonly { line: BasketLine; offer: SupplierOffer }[],
): SuborderGroup {
  const computed = lines.map(({ line, offer }) => computeLine(line, offer));
  const subtotal = sumMoney(computed.map((c) => c.subtotal));

  const minimumMet =
    isZeroMoney(supplier.minimumOrderValue) ||
    subtotal.amount >= supplier.minimumOrderValue.amount;
  const amountToMinimum = minimumMet
    ? zero(subtotal.currency)
    : subMoney(supplier.minimumOrderValue, subtotal);

  let delivery: KnownDelivery | UnknownDelivery;
  if (supplier.deliveryFee === null) {
    // We do NOT fabricate a delivery cost; it stays explicitly unknown.
    delivery = { known: false, reason: "not_stated" };
  } else {
    const fee = supplier.deliveryFee;
    const threshold = supplier.freeDeliveryThreshold;
    const free =
      threshold !== null &&
      !isZeroMoney(threshold) &&
      subtotal.amount >= threshold.amount;
    delivery = {
      known: true,
      fee: free ? zero(fee.currency) : fee,
      freeBecauseThresholdMet: free,
    };
  }

  const blockers: string[] = [];
  for (const c of computed) {
    if (c.problem?.kind === "quantity") blockers.push(c.problem.message);
    if (c.problem?.kind === "archived") blockers.push("Позиция больше не продаётся.");
    if (c.problem?.kind === "price_unknown") blockers.push("Цена не указана.");
  }
  if (!minimumMet) {
    blockers.push(
      `Не достигнут минимум поставщика: не хватает ${formatMoney(amountToMinimum)}.`,
    );
  }

  const total = delivery.known
    ? {
        amount: subtotal.amount + delivery.fee.amount,
        currency: subtotal.currency,
      }
    : subtotal;

  return {
    supplierId: supplier.id,
    supplier,
    lines: computed,
    subtotal,
    minimumOrderValue: supplier.minimumOrderValue,
    minimumMet,
    amountToMinimum,
    delivery,
    total,
    hasUnknownDelivery: !delivery.known,
    readyToSubmit: blockers.length === 0,
    blockers,
  };
}

export function computeCart(
  basket: Basket,
  offersById: ReadonlyMap<string, SupplierOffer>,
  suppliersById: ReadonlyMap<string, SupplierProfile>,
): CartComputation {
  const bySupplier = new Map<
    string,
    { supplier: SupplierProfile; lines: { line: BasketLine; offer: SupplierOffer }[] }
  >();

  for (const line of basket.lines) {
    const offer = offersById.get(line.offerId);
    const supplier = suppliersById.get(line.supplierId);
    if (!offer || !supplier) continue;
    const existing = bySupplier.get(line.supplierId);
    if (existing) {
      existing.lines.push({ line, offer });
    } else {
      bySupplier.set(line.supplierId, { supplier, lines: [{ line, offer }] });
    }
  }

  const groups = [...bySupplier.values()].map((g) =>
    computeSuborderGroup(g.supplier, g.lines),
  );

  const grandSubtotal = sumMoney(groups.map((g) => g.subtotal));
  const knownDeliveryTotal = sumMoney(
    groups.flatMap((g) => (g.delivery.known ? [g.delivery.fee] : [])),
  );

  return {
    groups,
    supplierCount: groups.length,
    grandSubtotal,
    knownDeliveryTotal,
    anyUnknownDelivery: groups.some((g) => g.hasUnknownDelivery),
  };
}

/**
 * Compare the price snapshot captured when a line was added against the live
 * price, so the buyer sees a delta rather than a silent overwrite.
 */
export function priceDelta(
  line: BasketLine,
  liveOffer: SupplierOffer,
): {
  changed: boolean;
  before: Money | null;
  after: Money | null;
  note: "changed" | "unchanged" | "unknown";
} {
  const before = line.addedAtPriceSnapshot;
  const after = liveOffer.pricePerSellUnit.value;
  if (before === null || after === null) {
    return { changed: false, before, after, note: "unknown" };
  }
  const changed = before.amount !== after.amount || before.currency !== after.currency;
  return { changed, before, after, note: changed ? "changed" : "unchanged" };
}

/** Helper used in tests and UI to build a Money quickly without floats. */
export const minor = (amount: number, currency: "KZT" = "KZT"): Money =>
  money(amount, currency);
