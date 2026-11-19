/**
 * Order lifecycle state machines.
 *
 * Three INDEPENDENT dimensions are modelled separately so a success in one
 * never falsely marks another as complete:
 *
 *   1. Suborder agreement:  draft -> submitted -> (change negotiation) -> confirmed/rejected/expired/cancelled
 *   2. Fulfillment:         not_started -> packing -> ready -> shipped -> delivered -> receiving -> completed
 *   3. Payment:             not_processed (P0 never processes payment)
 *
 * Allowed transitions are declared centrally and validated by `canTransition*`.
 * Impossible transitions are rejected in the domain layer, not just hidden in UI.
 */

import type { FulfillmentStatus, PaymentStatus, SuborderStatus } from "./entities";

/* ------------------------- Agreement lifecycle ------------------------- */

const SUBORDER_TRANSITIONS: Record<SuborderStatus, readonly SuborderStatus[]> = {
  draft: ["submitted", "cancelled"],
  submitted: ["awaiting_supplier", "cancelled"],
  awaiting_supplier: [
    "change_proposed",
    "confirmed",
    "partially_confirmed",
    "rejected",
    "expired",
    "cancelled",
  ],
  // A proposed change ALWAYS returns to the buyer for an explicit decision.
  change_proposed: ["awaiting_buyer_decision", "cancelled"],
  awaiting_buyer_decision: ["confirmed", "rejected", "expired", "cancelled"],
  confirmed: ["cancelled"],
  partially_confirmed: ["confirmed", "cancelled"],
  rejected: [],
  expired: [],
  cancelled: [],
};

export function canTransitionSuborder(from: SuborderStatus, to: SuborderStatus): boolean {
  return SUBORDER_TRANSITIONS[from].includes(to);
}

export function assertSuborderTransition(from: SuborderStatus, to: SuborderStatus): void {
  if (!canTransitionSuborder(from, to)) {
    throw new Error(`Illegal suborder transition: ${from} -> ${to}`);
  }
}

export function nextSuborderStatus(
  from: SuborderStatus,
  to: SuborderStatus,
): SuborderStatus {
  assertSuborderTransition(from, to);
  return to;
}

/* --------------------------- Fulfillment ------------------------------ */

const FULFILLMENT_TRANSITIONS: Record<FulfillmentStatus, readonly FulfillmentStatus[]> = {
  not_started: ["packing"],
  packing: ["ready_for_handover"],
  ready_for_handover: ["shipped"],
  shipped: ["delivered"],
  delivered: ["receiving"],
  receiving: ["completed"],
  completed: [],
};

export function canTransitionFulfillment(
  from: FulfillmentStatus,
  to: FulfillmentStatus,
): boolean {
  return FULFILLMENT_TRANSITIONS[from].includes(to);
}

export function assertFulfillmentTransition(
  from: FulfillmentStatus,
  to: FulfillmentStatus,
): void {
  if (!canTransitionFulfillment(from, to)) {
    throw new Error(`Illegal fulfillment transition: ${from} -> ${to}`);
  }
}

/**
 * Fulfillment may only begin once the suborder agreement is finalised.
 * This keeps "confirmed" and "shipped" from being conflated.
 */
export function canStartFulfillment(status: SuborderStatus): boolean {
  return status === "confirmed" || status === "partially_confirmed";
}

/* ------------------------------ Payment -------------------------------- */

/**
 * P0 never moves payment past "not_processed". This function exists so a future
 * product decision can be modelled deliberately, and so any accidental attempt
 * to mark payment complete in P0 throws loudly.
 */
export function canTransitionPayment(from: PaymentStatus, to: PaymentStatus): boolean {
  if (to !== "not_processed" && to !== "not_applicable_demo") {
    return false;
  }
  void from;
  return true;
}

/* --------------------------- Label helpers ----------------------------- */

export const SUBORDER_STATUS_LABELS: Record<SuborderStatus, string> = {
  draft: "Черновик",
  submitted: "Отправлено (демо)",
  awaiting_supplier: "Ожидает ответа поставщика",
  change_proposed: "Поставщик предложил изменение",
  awaiting_buyer_decision: "Ожидает решения покупателя",
  confirmed: "Подтверждено",
  partially_confirmed: "Подтверждено частично",
  rejected: "Отклонено",
  expired: "Истекло",
  cancelled: "Отменено",
};

export const FULFILLMENT_STATUS_LABELS: Record<FulfillmentStatus, string> = {
  not_started: "Не начато",
  packing: "Сборка",
  ready_for_handover: "Готово к передаче",
  shipped: "Отгружено поставщиком",
  delivered: "Доставлено",
  receiving: "Приёмка",
  completed: "Завершено",
};

export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  not_processed: "Платёж в прототипе не обрабатывается",
  not_applicable_demo: "Платёж — вне демонстрации",
};
