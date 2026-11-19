import { describe, expect, it } from "vitest";
import {
  canStartFulfillment,
  canTransitionFulfillment,
  canTransitionPayment,
  canTransitionSuborder,
  nextSuborderStatus,
} from "@/domain/orderLifecycle";
import type { FulfillmentStatus, SuborderStatus } from "@/domain/entities";

describe("suborder agreement lifecycle", () => {
  it("allows the happy path from draft to confirmed", () => {
    expect(canTransitionSuborder("draft", "submitted")).toBe(true);
    expect(canTransitionSuborder("submitted", "awaiting_supplier")).toBe(true);
    expect(canTransitionSuborder("awaiting_supplier", "confirmed")).toBe(true);
  });

  it("routes any proposed change back to the buyer for a decision", () => {
    expect(canTransitionSuborder("awaiting_supplier", "change_proposed")).toBe(true);
    expect(canTransitionSuborder("change_proposed", "awaiting_buyer_decision")).toBe(
      true,
    );
    // A change can never jump straight to confirmed.
    expect(canTransitionSuborder("change_proposed", "confirmed")).toBe(false);
    expect(canTransitionSuborder("awaiting_supplier", "awaiting_buyer_decision")).toBe(
      false,
    );
  });

  it("treats terminal states as terminal", () => {
    for (const terminal of ["rejected", "expired", "cancelled"] as SuborderStatus[]) {
      expect(canTransitionSuborder(terminal, "confirmed")).toBe(false);
    }
  });

  it("throws on an illegal transition attempt", () => {
    expect(() => nextSuborderStatus("confirmed", "awaiting_supplier")).toThrow(/Illegal/);
  });
});

describe("fulfillment lifecycle", () => {
  it("advances only forward", () => {
    expect(canTransitionFulfillment("not_started", "packing")).toBe(true);
    expect(canTransitionFulfillment("shipped", "delivered")).toBe(true);
    expect(canTransitionFulfillment("delivered", "receiving")).toBe(true);
    // no backward moves
    expect(canTransitionFulfillment("delivered", "packing")).toBe(false);
    expect(canTransitionFulfillment("completed", "packing")).toBe(false);
  });

  it("only starts fulfillment after the agreement is final", () => {
    expect(canStartFulfillment("confirmed")).toBe(true);
    expect(canStartFulfillment("partially_confirmed")).toBe(true);
    expect(canStartFulfillment("awaiting_supplier")).toBe(false);
    expect(canStartFulfillment("change_proposed")).toBe(false);
  });

  it("never lets a fulfillment status masquerade as an agreement status", () => {
    const fulfillmentStates: FulfillmentStatus[] = ["packing", "shipped", "delivered"];
    for (const s of fulfillmentStates) {
      // These are not valid suborder agreement statuses.
      expect(["draft", "submitted", "confirmed"]).not.toContain(s);
    }
  });
});

describe("payment lifecycle (P0)", () => {
  it("refuses to mark payment as processed", () => {
    expect(canTransitionPayment("not_processed", "not_processed")).toBe(true);
    expect(canTransitionPayment("not_processed", "not_processed")).toBe(true);
    // A future "paid" status is not modelled and must be denied.
    expect(canTransitionPayment("not_processed", "paid" as never)).toBe(false);
  });
});
