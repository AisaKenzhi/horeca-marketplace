/**
 * Buyer-side adapter for the existing supplier-suborder workflow RPCs.
 *
 * The buyer never sees another tenant's request. A decision always names both
 * the workflow expectedVersion and the exact termsVersion being decided, so a
 * stale proposal can never be silently accepted. No new backend contract here.
 */
import { isCurrentSupplierSuborderTermsVersion } from "@/domain/supplierSuborderWorkflow";
import type { SupplierSuborderWorkflow } from "@/domain/supplierSuborderWorkflow";
import type { Database, Json, MembershipRole, OrganizationType } from "./database.types";
import type { WorkspaceClient } from "./workspace";
import {
  decodeSupplierSuborderWorkflowRow,
  newSupplierSuborderIdempotencyKey,
  supplierSuborderClientErrorMessage,
  SupplierSuborderClientError,
} from "./supplierSuborders";

export type BuyerTermsScope = {
  readonly organizationId: string;
  readonly organizationType: OrganizationType;
  readonly role: MembershipRole;
};

export type BuyerTermsRow =
  Database["public"]["Functions"]["list_buyer_supplier_suborder_workflows"]["Returns"][number];

export interface BuyerTermsDecision {
  readonly workflow: SupplierSuborderWorkflow;
  readonly termsVersion: number;
  readonly reason: string;
  readonly idempotencyKey: string;
}

export interface BuyerTermsReceipt {
  readonly supplierSuborderId: string;
  readonly status: SupplierSuborderWorkflow["status"];
  readonly workflowVersion: number;
  readonly currentTermsVersion: number;
  readonly eventId: string;
  readonly replayed: boolean;
}

export interface BuyerTermsAdapter {
  list(
    client: WorkspaceClient,
    scope: BuyerTermsScope,
    buyerRequestId: string,
  ): Promise<readonly SupplierSuborderWorkflow[]>;
  accept(
    client: WorkspaceClient,
    scope: BuyerTermsScope,
    decision: BuyerTermsDecision,
  ): Promise<BuyerTermsReceipt>;
  reject(
    client: WorkspaceClient,
    scope: BuyerTermsScope,
    decision: BuyerTermsDecision,
  ): Promise<BuyerTermsReceipt>;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function mapRpcError(error: unknown): SupplierSuborderClientError {
  switch (errorCode(error)) {
    case "42501":
      return new SupplierSuborderClientError("forbidden");
    case "P0002":
    case "PGRST116":
      return new SupplierSuborderClientError("not_found");
    case "22P02":
    case "23503":
    case "23514":
      return new SupplierSuborderClientError("invalid_input");
    case "40001":
      return new SupplierSuborderClientError("version_conflict");
    case "55000":
      return new SupplierSuborderClientError("invalid_transition");
    case "P0001":
      return new SupplierSuborderClientError("idempotency_conflict");
    default:
      return new SupplierSuborderClientError("operation_failed");
  }
}

export function canReadBuyerTerms(role: MembershipRole): boolean {
  return role === "owner" || role === "admin" || role === "buyer" || role === "viewer";
}

export function canDecideBuyerTerms(role: MembershipRole): boolean {
  return role === "owner" || role === "admin" || role === "buyer";
}

function assertBuyerScope(scope: BuyerTermsScope, permission: "read" | "decide"): void {
  if (
    !isUuid(scope.organizationId) ||
    scope.organizationType !== "buyer" ||
    !canReadBuyerTerms(scope.role) ||
    (permission === "decide" && !canDecideBuyerTerms(scope.role))
  ) {
    throw new SupplierSuborderClientError("forbidden");
  }
}

function isJsonObject(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function decodeBuyerReceipt(value: Json): BuyerTermsReceipt {
  if (!isJsonObject(value)) throw new SupplierSuborderClientError("operation_failed");
  const supplierSuborderId = value.supplier_suborder_id;
  const status = value.status;
  const workflowVersion = value.workflow_version;
  const currentTermsVersion = value.current_terms_version;
  const eventId = value.event_id;
  const replayed = value.replayed;
  if (
    typeof supplierSuborderId !== "string" ||
    !isUuid(supplierSuborderId) ||
    typeof status !== "string" ||
    ![
      "awaiting_supplier",
      "supplier_accepted",
      "supplier_rejected",
      "awaiting_buyer_decision",
      "buyer_accepted",
      "buyer_rejected",
    ].includes(status) ||
    typeof workflowVersion !== "number" ||
    !Number.isSafeInteger(workflowVersion) ||
    workflowVersion < 1 ||
    typeof currentTermsVersion !== "number" ||
    !Number.isSafeInteger(currentTermsVersion) ||
    currentTermsVersion < 1 ||
    typeof eventId !== "string" ||
    !isUuid(eventId) ||
    typeof replayed !== "boolean"
  ) {
    throw new SupplierSuborderClientError("operation_failed");
  }
  return {
    supplierSuborderId,
    status: status as BuyerTermsReceipt["status"],
    workflowVersion,
    currentTermsVersion,
    eventId,
    replayed,
  };
}

function assertDecision(scope: BuyerTermsScope, decision: BuyerTermsDecision): void {
  assertBuyerScope(scope, "decide");
  if (
    !isUuid(decision.workflow.supplierSuborderId) ||
    !isUuid(decision.idempotencyKey) ||
    !Number.isSafeInteger(decision.termsVersion) ||
    decision.termsVersion < 1
  ) {
    throw new SupplierSuborderClientError("invalid_input");
  }
  if (!isCurrentSupplierSuborderTermsVersion(decision.workflow, decision.termsVersion)) {
    throw new SupplierSuborderClientError("invalid_transition");
  }
}

export async function listBuyerTermsWorkflows(
  client: WorkspaceClient,
  scope: BuyerTermsScope,
  buyerRequestId: string,
): Promise<readonly SupplierSuborderWorkflow[]> {
  assertBuyerScope(scope, "read");
  if (!isUuid(buyerRequestId)) throw new SupplierSuborderClientError("invalid_input");
  const { data, error } = await client.rpc("list_buyer_supplier_suborder_workflows", {
    p_buyer_organization_id: scope.organizationId,
    p_buyer_request_id: buyerRequestId,
  });
  if (error) throw mapRpcError(error);
  if (!data) throw new SupplierSuborderClientError("operation_failed");
  return (data as readonly BuyerTermsRow[]).map(decodeSupplierSuborderWorkflowRow);
}

async function decide(
  client: WorkspaceClient,
  scope: BuyerTermsScope,
  decision: BuyerTermsDecision,
  action: "accept" | "reject",
): Promise<BuyerTermsReceipt> {
  assertDecision(scope, decision);
  const reason = decision.reason.trim();
  if (action === "reject" && (reason.length < 1 || reason.length > 1000)) {
    throw new SupplierSuborderClientError("invalid_input");
  }
  const payload = {
    p_buyer_organization_id: scope.organizationId,
    p_supplier_suborder_id: decision.workflow.supplierSuborderId,
    p_terms_version: decision.termsVersion,
    p_expected_version: decision.workflow.workflowVersion,
    p_idempotency_key: decision.idempotencyKey,
    ...(action === "reject" ? { p_reason: reason } : {}),
  };
  const { data, error } = await client.rpc(
    action === "accept"
      ? "accept_buyer_supplier_suborder_version"
      : "reject_buyer_supplier_suborder_version",
    payload,
  );
  if (error) throw mapRpcError(error);
  if (!data) throw new SupplierSuborderClientError("operation_failed");
  const receipt = decodeBuyerReceipt(data);
  if (receipt.supplierSuborderId !== decision.workflow.supplierSuborderId) {
    throw new SupplierSuborderClientError("operation_failed");
  }
  return receipt;
}

export const buyerTermsAdapter: BuyerTermsAdapter = {
  list: (client, scope, buyerRequestId) =>
    listBuyerTermsWorkflows(client, scope, buyerRequestId),
  accept: (client, scope, decision) => decide(client, scope, decision, "accept"),
  reject: (client, scope, decision) => decide(client, scope, decision, "reject"),
};

export { newSupplierSuborderIdempotencyKey as newBuyerTermsIdempotencyKey };
export { supplierSuborderClientErrorMessage as buyerTermsClientErrorMessage };
