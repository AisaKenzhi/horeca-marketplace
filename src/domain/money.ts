/**
 * Money handling.
 *
 * Money is stored as an integer count of the currency's minimal unit.
 * For KZT that is whole tenge (ISO 4217 minor unit = 0). We never store money
 * as a binary floating point number, and we never divide internally except
 * through explicit, tested helpers.
 */

import { validationError } from "./errors";

export type CurrencyCode = "KZT";

export interface Money {
  /** Integer amount in the currency's minor unit. Always finite, always integral. */
  readonly amount: number;
  readonly currency: CurrencyCode;
}

export function isInteger(value: number): boolean {
  // Number.isInteger accepts values above MAX_SAFE_INTEGER where arithmetic is
  // no longer exact. Money must stay exactly representable.
  return Number.isSafeInteger(value);
}

export function money(amount: number, currency: CurrencyCode = "KZT"): Money {
  if (!isInteger(amount)) {
    throw validationError(`Money amount must be an integer minor unit, got: ${amount}`);
  }
  return { amount, currency };
}

export function zero(currency: CurrencyCode = "KZT"): Money {
  return { amount: 0, currency };
}

function assertSameCurrency(a: Money, b: Money): void {
  const ca: string = a.currency;
  const cb: string = b.currency;
  if (ca !== cb) {
    throw validationError(`Currency mismatch: ${ca} vs ${cb}`);
  }
}

export function addMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount + b.amount, a.currency);
}

export function subMoney(a: Money, b: Money): Money {
  assertSameCurrency(a, b);
  return money(a.amount - b.amount, a.currency);
}

export function sumMoney(
  values: readonly Money[],
  currency: CurrencyCode = "KZT",
): Money {
  return values.reduce((acc, v) => addMoney(acc, v), zero(currency));
}

/**
 * Multiply money by a positive integer quantity.
 * Throws on non-integer quantity to avoid silent rounding.
 */
export function multiplyMoney(value: Money, quantity: number): Money {
  if (!isInteger(quantity)) {
    throw validationError(`Quantity must be an integer, got: ${quantity}`);
  }
  return money(value.amount * quantity, value.currency);
}

export function compareMoney(a: Money, b: Money): number {
  assertSameCurrency(a, b);
  return a.amount < b.amount ? -1 : a.amount > b.amount ? 1 : 0;
}

export function isZeroMoney(value: Money): boolean {
  return value.amount === 0;
}

export function isNegativeMoney(value: Money): boolean {
  return value.amount < 0;
}

/** Format for display. KZT has no minor unit, so we show whole tenge. */
export function formatMoney(value: Money, locale = "ru-KZ"): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: value.currency,
    maximumFractionDigits: 0,
  }).format(value.amount);
}
