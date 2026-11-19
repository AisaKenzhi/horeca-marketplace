/**
 * Display helpers. Pure formatting only; keep user-facing text in i18n.
 */

import {
  AVAILABILITY_LABELS,
  type AvailabilityStatus,
  type TimestampedValue,
} from "@/domain/freshness";
import { baseUnitsPerSellUnit } from "@/domain/packaging";
import type { SupplierOffer } from "@/domain/entities";

export function describePackaging(offer: SupplierOffer): string {
  const { sellUnit } = offer.packaging;
  const total = baseUnitsPerSellUnit(sellUnit);
  const unit = sellUnit.packSize.baseUnit;
  const parts = [sellUnit.label];
  if (sellUnit.unitsPerSellUnit > 1) {
    parts.push(`${sellUnit.unitsPerSellUnit} × ${sellUnit.packSize.amount} ${unit}`);
  } else {
    parts.push(`${sellUnit.packSize.amount} ${unit}`);
  }
  parts.push(`= ${total} ${unit}`);
  return parts.join(" · ");
}

export function availabilityLabel(a: TimestampedValue<AvailabilityStatus>): string {
  if (a.value === null) return "наличие не указано";
  return AVAILABILITY_LABELS[a.value];
}

export function relativeAge(observedAt: string | null, nowIso: string): string {
  if (observedAt === null) return "—";
  const diffMs = Date.parse(nowIso) - Date.parse(observedAt);
  if (!Number.isFinite(diffMs) || diffMs < 0) return "—";
  const hours = Math.floor(diffMs / 3_600_000);
  if (hours < 1) return "только что (демо)";
  if (hours < 24) return `${hours} ч назад (демо)`;
  const days = Math.floor(hours / 24);
  return `${days} дн. назад (демо)`;
}
