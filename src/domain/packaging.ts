/**
 * Packaging and sell-unit rules.
 *
 * The brief is emphatic that we must not conflate:
 *   - the sell unit (what you actually buy, e.g. "1 box of 12 x 0.5 L")
 *   - the pack size (contents per sell unit)
 *   - the price per sell unit
 *   - the unit price (price per base unit: kg / L / piece)
 *   - MOQ (minimum order quantity, per line)
 *   - order step / multiple
 *   - supplier minimum order value (whole suborder)
 *   - free-delivery threshold
 *
 * All of those are separate, explicit values here. Nothing is inferred silently.
 */

export type BaseUnit = "kg" | "l" | "piece";

/** The physical measure of a sell unit's contents. */
export interface PackSize {
  /** Amount of the base unit contained in one sell unit. Positive. */
  readonly amount: number;
  readonly baseUnit: BaseUnit;
}

/**
 * A sell unit is what the buyer orders: e.g. 1 item = "box of 12 x 0.5 L".
 * `unitsPerSellUnit` x `packSize` == total base units in one sell unit.
 */
export interface SellUnit {
  /** Human label, e.g. "ящик 12 × 0,5 л". Test/demo text only. */
  readonly label: string;
  /** Number of inner packs in one sell unit. Must be a positive integer. */
  readonly unitsPerSellUnit: number;
  /** Size of one inner pack. */
  readonly packSize: PackSize;
}

export interface PackagingSpec {
  readonly sellUnit: SellUnit;
  /** Minimum order quantity in sell units. Must be a positive integer. */
  readonly moq: number;
  /** Order step / multiple in sell units. Must be a positive integer. */
  readonly orderStep: number;
}

export function isValidPackaging(spec: PackagingSpec): boolean {
  const { sellUnit, moq, orderStep } = spec;
  return (
    Number.isInteger(sellUnit.unitsPerSellUnit) &&
    sellUnit.unitsPerSellUnit > 0 &&
    sellUnit.packSize.amount > 0 &&
    Number.isInteger(moq) &&
    moq > 0 &&
    Number.isInteger(orderStep) &&
    orderStep > 0
  );
}

/** Total base units in one sell unit (contents of a single sell unit). */
export function baseUnitsPerSellUnit(sellUnit: SellUnit): number {
  return sellUnit.unitsPerSellUnit * sellUnit.packSize.amount;
}

/**
 * Validate an order quantity against MOQ and order step for ONE line.
 * Returns a typed result so the UI can explain exactly what is wrong.
 */
export type QuantityCheck =
  | { readonly ok: true; readonly quantity: number }
  | { readonly ok: false; readonly reason: QuantityProblem; readonly message: string };

export type QuantityProblem = "not_positive_integer" | "below_moq" | "not_step_multiple";

export function checkOrderQuantity(quantity: number, spec: PackagingSpec): QuantityCheck {
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return {
      ok: false,
      reason: "not_positive_integer",
      message: "Количество должно быть целым положительным числом.",
    };
  }
  if (quantity < spec.moq) {
    return {
      ok: false,
      reason: "below_moq",
      message: `Минимальный заказ по позиции: ${spec.moq}.`,
    };
  }
  if (quantity % spec.orderStep !== 0) {
    return {
      ok: false,
      reason: "not_step_multiple",
      message: `Количество должно быть кратно шагу ${spec.orderStep}.`,
    };
  }
  return { ok: true, quantity };
}

/**
 * Unit price comparison.
 *
 * We only expose a per-base-unit price when the conversion factor is exact and
 * the base units are compatible. Otherwise the items are declared incomparable
 * rather than shown with a guessed number.
 */
export type UnitPriceComparison =
  | {
      readonly comparable: true;
      readonly baseUnit: BaseUnit;
      /** Price of one base unit, rounded to the minor unit, with the exact remainder noted. */
      readonly perBaseUnitMinor: number;
      readonly exactlyDivisible: boolean;
    }
  | {
      readonly comparable: false;
      readonly reason: "incompatible_base_unit" | "invalid_pack";
    };

export function unitPrice(
  pricePerSellUnitMinor: number,
  sellUnit: SellUnit,
): UnitPriceComparison {
  const perUnit = baseUnitsPerSellUnit(sellUnit);
  if (!Number.isFinite(perUnit) || perUnit <= 0) {
    return { comparable: false, reason: "invalid_pack" };
  }
  const exact = pricePerSellUnitMinor / perUnit;
  return {
    comparable: true,
    baseUnit: sellUnit.packSize.baseUnit,
    perBaseUnitMinor: Math.round(exact),
    exactlyDivisible: Number.isInteger(exact),
  };
}

/** Compare two offers' unit prices only when they share a base unit. */
export function compareUnitPrices(
  a: { pricePerSellUnitMinor: number; sellUnit: SellUnit },
  b: { pricePerSellUnitMinor: number; sellUnit: SellUnit },
): { comparable: boolean; cheaper?: "a" | "b"; equal?: boolean } {
  const ua = unitPrice(a.pricePerSellUnitMinor, a.sellUnit);
  const ub = unitPrice(b.pricePerSellUnitMinor, b.sellUnit);
  if (!ua.comparable || !ub.comparable || ua.baseUnit !== ub.baseUnit) {
    return { comparable: false };
  }
  const delta = ua.perBaseUnitMinor - ub.perBaseUnitMinor;
  if (delta === 0) return { comparable: true, equal: true };
  return { comparable: true, cheaper: delta < 0 ? "a" : "b" };
}
