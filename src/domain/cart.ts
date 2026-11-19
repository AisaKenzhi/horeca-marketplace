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
import {
  DEFAULT_FRESHNESS_CONFIG,
  evaluateFreshness,
  type Freshness,
  type FreshnessConfig,
} from "./freshness";

export interface ComputedLine {
  readonly line: BasketLine;
  readonly offer: SupplierOffer;
  /** Deterministic line subtotal: quantity x price per sell unit. */
  readonly subtotal: Money;
  /** Set when the live price is unavailable or the offer is archived. */
  readonly problem: LineProblem | null;
  /** Freshness of the live price observation (for badge + confirmation logic). */
  readonly priceFreshness: Freshness;
  /** True when the line's live price differs from the snapshot captured on add. */
  readonly priceChangedSinceAdded: boolean;
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

/** Whether a supplier's declared zones cover the selected buyer location. */
export type ZoneCoverage =
  | { readonly state: "covered" }
  | { readonly state: "not_covered"; readonly zone: string }
  | { readonly state: "unknown"; readonly zone: string | null };

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
  /** Whether the supplier covers the selected delivery zone. */
  readonly zoneCoverage: ZoneCoverage;
  /**
   * True only when every line is valid, the supplier minimum is met, and the
   * supplier covers the location zone. Stale prices are NOT silently accepted:
   * they are surfaced as blockers so the buyer must re-confirm.
   */
  readonly readyToSubmit: boolean;
  readonly blockers: readonly string[];
  /** Lines whose live price is stale or changed since the snapshot. */
  readonly needsPriceConfirmation: boolean;
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

export function computeLine(
  line: BasketLine,
  offer: SupplierOffer,
  nowIso: string,
  config: FreshnessConfig = DEFAULT_FRESHNESS_CONFIG,
): ComputedLine {
  const priceFreshness = evaluateFreshness(offer.pricePerSellUnit, nowIso, config);
  if (offer.archived) {
    return {
      line,
      offer,
      subtotal: zero(),
      problem: { kind: "archived" },
      priceFreshness,
      priceChangedSinceAdded: false,
    };
  }
  const price = priceOf(offer);
  if (price === null) {
    return {
      line,
      offer,
      subtotal: zero(),
      problem: { kind: "price_unknown" },
      priceFreshness,
      priceChangedSinceAdded: false,
    };
  }
  const qtyCheck = checkOrderQuantity(line.quantity, offer.packaging);
  if (!qtyCheck.ok) {
    return {
      line,
      offer,
      subtotal: zero(),
      problem: { kind: "quantity", reason: qtyCheck.reason, message: qtyCheck.message },
      priceFreshness,
      priceChangedSinceAdded: false,
    };
  }
  const priceChangedSinceAdded =
    line.addedAtPriceSnapshot !== null &&
    (line.addedAtPriceSnapshot.amount !== price.amount ||
      line.addedAtPriceSnapshot.currency !== price.currency);
  // A stale price is NOT silently usable: it becomes a blocker so the buyer
  // must explicitly re-confirm the current terms before submitting.
  if (priceFreshness.state !== "fresh") {
    return {
      line,
      offer,
      subtotal: multiplyMoney(price, line.quantity),
      problem: { kind: "price_stale", lastKnown: price },
      priceFreshness,
      priceChangedSinceAdded,
    };
  }
  return {
    line,
    offer,
    subtotal: multiplyMoney(price, line.quantity),
    problem: null,
    priceFreshness,
    priceChangedSinceAdded,
  };
}

/**
 * Zone coverage: a supplier covers a location when its declared zones include
 * the location's zone. An unknown/empty zone is reported as unknown, never as
 * "delivery available".
 */
export function zoneCoverage(
  supplier: SupplierProfile,
  zone: string | null | undefined,
): ZoneCoverage {
  if (zone === null || zone === undefined || zone.length === 0) {
    return { state: "unknown", zone: null };
  }
  if (supplier.deliveryZones.length === 0) {
    return { state: "unknown", zone };
  }
  if (supplier.deliveryZones.includes(zone)) {
    return { state: "covered" };
  }
  return { state: "not_covered", zone };
}

export function computeSuborderGroup(
  supplier: SupplierProfile,
  lines: readonly { line: BasketLine; offer: SupplierOffer }[],
  options: {
    readonly nowIso?: string;
    readonly config?: FreshnessConfig;
    /** The buyer location's delivery zone, when one is selected. */
    readonly locationZone?: string | null;
  } = {},
): SuborderGroup {
  const nowIso = options.nowIso ?? "1970-01-01T00:00:00.000Z";
  const config = options.config ?? DEFAULT_FRESHNESS_CONFIG;
  const computed = lines.map(({ line, offer }) =>
    computeLine(line, offer, nowIso, config),
  );
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

  const coverage = zoneCoverage(supplier, options.locationZone ?? null);

  const blockers: string[] = [];
  let needsPriceConfirmation = false;
  for (const c of computed) {
    if (c.problem?.kind === "quantity") blockers.push(c.problem.message);
    if (c.problem?.kind === "archived") blockers.push("Позиция больше не продаётся.");
    if (c.problem?.kind === "price_unknown") blockers.push("Цена не указана.");
    if (c.problem?.kind === "price_stale") {
      blockers.push(
        `Цена устарела и требует подтверждения: последняя известная ${formatMoney(
          c.problem.lastKnown,
        )}.`,
      );
      needsPriceConfirmation = true;
    }
    if (c.priceChangedSinceAdded) {
      blockers.push(
        "Цена изменилась с момента добавления — подтвердите актуальную цену.",
      );
      needsPriceConfirmation = true;
    }
  }
  if (!minimumMet) {
    blockers.push(
      `Не достигнут минимум поставщика: не хватает ${formatMoney(amountToMinimum)}.`,
    );
  }
  if (coverage.state === "not_covered") {
    blockers.push(`Поставщик не доставляет в выбранную зону (${coverage.zone}).`);
  }
  if (coverage.state === "unknown") {
    blockers.push("Зона доставки не подтверждена поставщиком — нужно уточнить.");
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
    zoneCoverage: coverage,
    readyToSubmit: blockers.length === 0,
    blockers,
    needsPriceConfirmation,
  };
}

export function computeCart(
  basket: Basket,
  offersById: ReadonlyMap<string, SupplierOffer>,
  suppliersById: ReadonlyMap<string, SupplierProfile>,
  options: {
    readonly nowIso?: string;
    readonly config?: FreshnessConfig;
    readonly locationZone?: string | null;
  } = {},
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
    computeSuborderGroup(g.supplier, g.lines, options),
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
