/**
 * Data freshness rules.
 *
 * Price and availability are INDEPENDENT time-stamped observations. We never
 * present an unknown or stale value as if it were current. A configurable
 * threshold marks values that "need confirmation"; that threshold is a product
 * parameter, not a claimed market standard.
 */

export type FreshnessState = "fresh" | "stale" | "unknown";

export interface TimestampedValue<T> {
  /** The observed value, or null when we genuinely do not know it. */
  readonly value: T | null;
  /** When this value was last observed. Null means never observed. */
  readonly observedAt: string | null;
}

export interface FreshnessConfig {
  /** Values older than this many hours are considered stale. Product parameter. */
  readonly stalenessHours: number;
}

export const DEFAULT_FRESHNESS_CONFIG: FreshnessConfig = { stalenessHours: 24 };

export interface Freshness {
  readonly state: FreshnessState;
  /** Age in hours, or null when the value is unknown. */
  readonly ageHours: number | null;
  /** True when the value should be shown with a "needs confirmation" affordance. */
  readonly needsConfirmation: boolean;
}

function parseMs(iso: string): number | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Evaluate freshness of a timestamped value against `nowIso`.
 * `nowIso` is injected so tests are deterministic.
 */
export function evaluateFreshness<T>(
  value: TimestampedValue<T>,
  nowIso: string,
  config: FreshnessConfig = DEFAULT_FRESHNESS_CONFIG,
): Freshness {
  if (value.value === null || value.observedAt === null) {
    return { state: "unknown", ageHours: null, needsConfirmation: true };
  }
  const now = parseMs(nowIso);
  const then = parseMs(value.observedAt);
  if (now === null || then === null) {
    return { state: "unknown", ageHours: null, needsConfirmation: true };
  }
  const ageHours = (now - then) / 3_600_000;
  if (ageHours < 0) {
    // A future timestamp is not trustworthy; treat as needing confirmation.
    return { state: "unknown", ageHours, needsConfirmation: true };
  }
  const stale = ageHours > config.stalenessHours;
  return {
    state: stale ? "stale" : "fresh",
    ageHours,
    needsConfirmation: stale,
  };
}

/**
 * A price is usable as-is only when fresh. Stale/unknown prices must be
 * re-confirmed with the supplier before they bind an order.
 */
export function isPriceBinding(priceFreshness: Freshness): boolean {
  return priceFreshness.state === "fresh";
}

/** Human, honest rendering of availability. Unknown is never shown as "in stock". */
export function describeAvailability(
  availability: TimestampedValue<AvailabilityStatus>,
): string {
  if (availability.value === null) return "наличие не указано";
  switch (availability.value) {
    case "in_stock":
      return "в наличии (заявлено поставщиком)";
    case "low_stock":
      return "мало (заявлено поставщиком)";
    case "out_of_stock":
      return "нет в наличии (заявлено поставщиком)";
    case "on_request":
      return "под заказ (заявлено поставщиком)";
  }
}

export type AvailabilityStatus = "in_stock" | "low_stock" | "out_of_stock" | "on_request";

export const AVAILABILITY_LABELS: Record<AvailabilityStatus, string> = {
  in_stock: "В наличии",
  low_stock: "Мало",
  out_of_stock: "Нет в наличии",
  on_request: "Под заказ",
};
