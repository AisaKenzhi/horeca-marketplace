import { describe, expect, it } from "vitest";
import {
  DEFAULT_FRESHNESS_CONFIG,
  describeAvailability,
  evaluateFreshness,
  isPriceBinding,
  type TimestampedValue,
} from "@/domain/freshness";

const NOW = "2026-11-19T12:00:00.000Z";
const cfg = { stalenessHours: 24 };

function tv<T>(value: T | null, hoursAgo: number | null): TimestampedValue<T> {
  if (hoursAgo === null) return { value, observedAt: null };
  const ms = Date.parse(NOW) - hoursAgo * 3_600_000;
  return { value, observedAt: new Date(ms).toISOString() };
}

describe("freshness", () => {
  it("marks a recent observation fresh and binding", () => {
    const f = evaluateFreshness(tv(1000, 2), NOW, cfg);
    expect(f.state).toBe("fresh");
    expect(f.needsConfirmation).toBe(false);
    expect(isPriceBinding(f)).toBe(true);
  });

  it("marks an old observation stale and needing confirmation", () => {
    const f = evaluateFreshness(tv(1000, 48), NOW, cfg);
    expect(f.state).toBe("stale");
    expect(f.needsConfirmation).toBe(true);
    expect(isPriceBinding(f)).toBe(false);
  });

  it("treats unknown values as needing confirmation, never as fresh", () => {
    const f = evaluateFreshness(tv<number>(null, 1), NOW, cfg);
    expect(f.state).toBe("unknown");
    expect(f.needsConfirmation).toBe(true);
    expect(isPriceBinding(f)).toBe(false);
  });

  it("treats a missing timestamp as unknown", () => {
    const f = evaluateFreshness(tv(1000, null), NOW, cfg);
    expect(f.state).toBe("unknown");
  });

  it("does not trust future timestamps", () => {
    const future = new Date(Date.parse(NOW) + 3_600_000).toISOString();
    const f = evaluateFreshness({ value: 1, observedAt: future }, NOW, cfg);
    expect(f.state).toBe("unknown");
    expect(f.needsConfirmation).toBe(true);
  });

  it("never describes unknown availability as in stock", () => {
    expect(describeAvailability({ value: null, observedAt: NOW })).toContain(
      "не указано",
    );
    expect(describeAvailability({ value: "in_stock", observedAt: NOW })).toContain(
      "в наличии",
    );
  });

  it("uses the configured threshold, not a hardcoded one", () => {
    const strict = { stalenessHours: 1 };
    expect(evaluateFreshness(tv(1, 2), NOW, strict).state).toBe("stale");
    expect(evaluateFreshness(tv(1, 2), NOW, DEFAULT_FRESHNESS_CONFIG).state).toBe(
      "fresh",
    );
  });
});
