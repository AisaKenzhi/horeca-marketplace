/**
 * Shared presentational components.
 *
 * Kept small and reusable; no business rules live here. All user-facing text
 * comes from the i18n messages passed in, never hard-coded in the markup.
 */

import type { ReactNode } from "react";
import type { Freshness } from "@/domain/freshness";
import { formatMoney, type Money } from "@/domain/money";

export function MoneyText({ value }: { value: Money | null }): ReactNode {
  if (value === null) return <span className="muted">не указано</span>;
  return <span className="money">{formatMoney(value)}</span>;
}

export function FreshnessBadge({
  freshness,
  observedAt,
  labelUpdated,
  labelStale,
  labelUnknown,
}: {
  freshness: Freshness;
  observedAt: string | null;
  labelUpdated: string;
  labelStale: string;
  labelUnknown: string;
}): ReactNode {
  if (freshness.state === "unknown") {
    return (
      <span className="badge badge-unknown" title={observedAt ?? undefined}>
        {labelUnknown}
      </span>
    );
  }
  const when = observedAt ? new Date(observedAt).toLocaleString("ru-KZ") : "";
  if (freshness.state === "stale") {
    return (
      <span className="badge badge-stale">
        {labelStale} · {labelUpdated} {when}
      </span>
    );
  }
  return (
    <span className="badge badge-fresh">
      {labelUpdated} {when}
    </span>
  );
}

export function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "neutral" | "info" | "warn" | "ok" | "bad";
}): ReactNode {
  return <span className={`pill pill-${tone}`}>{label}</span>;
}

export function Section({
  heading,
  children,
  headingId,
}: {
  heading: string;
  children: ReactNode;
  headingId?: string;
}): ReactNode {
  return (
    <section className="card" aria-labelledby={headingId}>
      <h2 id={headingId} className="card-title">
        {heading}
      </h2>
      {children}
    </section>
  );
}

export function Notice({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "danger" | "demo";
  children: ReactNode;
}): ReactNode {
  return (
    <div className={`notice notice-${tone}`} role="note">
      {children}
    </div>
  );
}

export function EmptyState({ message }: { message: string }): ReactNode {
  return (
    <p className="empty" role="status">
      {message}
    </p>
  );
}

export function LoadingState({ message }: { message: string }): ReactNode {
  return (
    <p className="loading" role="status" aria-live="polite">
      {message}
    </p>
  );
}

export function ErrorState({ message }: { message: string }): ReactNode {
  return (
    <p className="error" role="alert">
      {message}
    </p>
  );
}
