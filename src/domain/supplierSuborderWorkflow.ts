/**
 * Typed contract for the persisted supplier-suborder response workflow.
 * A workflow decision is not a buyer order acceptance, stock reservation,
 * payment, invoice, supplier dispatch, or delivery commitment.
 */

export const SUPPLIER_SUBORDER_WORKFLOW_STATUSES = [
  "awaiting_supplier",
  "supplier_accepted",
  "supplier_rejected",
  "awaiting_buyer_decision",
  "buyer_accepted",
  "buyer_rejected",
] as const;

export type SupplierSuborderWorkflowStatus =
  (typeof SUPPLIER_SUBORDER_WORKFLOW_STATUSES)[number];

export const SUPPLIER_SUBORDER_WORKFLOW_ACTIONS = [
  "supplier_accept",
  "supplier_reject",
  "supplier_propose_version",
  "buyer_accept_version",
  "buyer_reject_version",
] as const;

export type SupplierSuborderWorkflowAction =
  (typeof SUPPLIER_SUBORDER_WORKFLOW_ACTIONS)[number];

export type SupplierSuborderWorkflowErrorCode =
  | "invalid_input"
  | "forbidden"
  | "not_found"
  | "version_conflict"
  | "idempotency_conflict"
  | "invalid_transition"
  | "operation_failed";

/** Exact decimal string avoids binary floating-point changes to quoted prices. */
export type SupplierSuborderPriceAmount = string;

export interface SupplierSuborderWorkflowLine {
  readonly buyerRequestLineId: string;
  readonly title: string;
  readonly sellUnitLabel: string;
  readonly unitsPerSellUnit: number;
  readonly packAmount: string;
  readonly packBaseUnit: "kg" | "l" | "piece";
  readonly quantity: number;
  readonly priceAmount: SupplierSuborderPriceAmount;
  readonly currency: string;
}

export interface SupplierSuborderWorkflow {
  readonly supplierSuborderId: string;
  readonly status: SupplierSuborderWorkflowStatus;
  /** Optimistic concurrency token; increments once per successful action. */
  readonly workflowVersion: number;
  /** Terms snapshot version; advances only when the supplier proposes terms. */
  readonly currentTermsVersion: number;
  readonly termsReason: string | null;
  readonly responseDeadlineAt: string | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly lines: readonly SupplierSuborderWorkflowLine[];
}

export interface SupplierSuborderWorkflowReceipt {
  readonly supplierSuborderId: string;
  readonly status: SupplierSuborderWorkflowStatus;
  readonly workflowVersion: number;
  readonly currentTermsVersion: number;
  readonly eventId: string;
  /** True only when this exact idempotent operation was replayed. */
  readonly replayed: boolean;
}

export interface SupplierSuborderActionContext {
  readonly organizationId: string;
  readonly supplierSuborderId: string;
  readonly expectedVersion: number;
  readonly idempotencyKey: string;
}

export interface SupplierSuborderProposalLine {
  readonly buyerRequestLineId: string;
  readonly quantity: number;
  /** Decimal string, at most 12 integer and 4 fractional digits. */
  readonly priceAmount: SupplierSuborderPriceAmount;
}

export type SupplierSuborderWorkflowCommand =
  | ({ readonly action: "supplier_accept" } & SupplierSuborderActionContext)
  | ({
      readonly action: "supplier_reject";
      readonly reason: string;
    } & SupplierSuborderActionContext)
  | ({
      readonly action: "supplier_propose_version";
      readonly reason: string;
      readonly responseDeadlineAt: string;
      /** Complete replacement terms: each existing line exactly once. */
      readonly lines: readonly SupplierSuborderProposalLine[];
    } & SupplierSuborderActionContext)
  | ({
      readonly action: "buyer_accept_version";
      readonly termsVersion: number;
    } & SupplierSuborderActionContext)
  | ({
      readonly action: "buyer_reject_version";
      readonly termsVersion: number;
      readonly reason?: string;
    } & SupplierSuborderActionContext);

const ALLOWED_ACTIONS_BY_STATUS: Readonly<
  Record<SupplierSuborderWorkflowStatus, readonly SupplierSuborderWorkflowAction[]>
> = {
  awaiting_supplier: ["supplier_accept", "supplier_reject", "supplier_propose_version"],
  supplier_accepted: [],
  supplier_rejected: [],
  awaiting_buyer_decision: ["buyer_accept_version", "buyer_reject_version"],
  buyer_accepted: [],
  buyer_rejected: [],
};

export function isSupplierSuborderWorkflowStatus(
  value: unknown,
): value is SupplierSuborderWorkflowStatus {
  return (
    typeof value === "string" &&
    SUPPLIER_SUBORDER_WORKFLOW_STATUSES.some((status) => status === value)
  );
}

/**
 * Local, reversible default for response deadlines: the timestamp is shown to
 * both sides but never changes the workflow. Silence and elapsed time are not
 * consent, rejection, reservation or an order. A real SLA policy is an owner
 * decision and is intentionally not inferred here.
 */
export const SUPPLIER_RESPONSE_DEADLINE_NOTICE =
  "Срок ответа указан для сведения: просрочка не меняет условия, не означает согласия и не создаёт заказ или резерв.";

export function hasResponseDeadlineElapsed(
  deadlineAt: string | null,
  nowIso: string,
): boolean {
  if (deadlineAt === null) return false;
  const deadline = Date.parse(deadlineAt);
  const now = Date.parse(nowIso);
  return Number.isFinite(deadline) && Number.isFinite(now) && deadline < now;
}

/** State-machine guard for consumers; the database remains authoritative. */
export function canApplySupplierSuborderWorkflowAction(
  status: SupplierSuborderWorkflowStatus,
  action: SupplierSuborderWorkflowAction,
): boolean {
  return ALLOWED_ACTIONS_BY_STATUS[status].includes(action);
}

/** Buyer decisions must name the exact live proposal, never a stale revision. */
export function isCurrentSupplierSuborderTermsVersion(
  workflow: Pick<SupplierSuborderWorkflow, "status" | "currentTermsVersion">,
  termsVersion: number,
): boolean {
  return (
    workflow.status === "awaiting_buyer_decision" &&
    Number.isSafeInteger(termsVersion) &&
    termsVersion === workflow.currentTermsVersion
  );
}
