import type {
  SupplierSuborderProposalLine,
  SupplierSuborderWorkflow,
  SupplierSuborderWorkflowReceipt,
  SupplierSuborderWorkflowStatus,
} from "@/domain/supplierSuborderWorkflow";
import {
  canApplySupplierSuborderWorkflowAction,
  isSupplierSuborderWorkflowStatus,
} from "@/domain/supplierSuborderWorkflow";
import type { Database, Json, MembershipRole, OrganizationType } from "./database.types";
import type { WorkspaceClient } from "./workspace";

export type SupplierSuborderClientErrorCode =
  | "invalid_input"
  | "forbidden"
  | "not_found"
  | "version_conflict"
  | "idempotency_conflict"
  | "invalid_transition"
  | "operation_failed";

export class SupplierSuborderClientError extends Error {
  constructor(readonly code: SupplierSuborderClientErrorCode) {
    super(code);
    this.name = "SupplierSuborderClientError";
  }
}

export type SupplierSuborderProposalDraftLine = SupplierSuborderProposalLine;

export type SupplierSuborderWorkflowRow =
  Database["public"]["Functions"]["list_supplier_suborders"]["Returns"][number];

export function canAccessSupplierSuborderInbox(role: MembershipRole): boolean {
  return role === "owner" || role === "admin" || role === "order_operator";
}

function assertSupplierAccess(
  organizationId: string,
  organizationType: OrganizationType,
  role: MembershipRole,
): void {
  if (!isUuid(organizationId)) throw new SupplierSuborderClientError("invalid_input");
  if (organizationType !== "supplier" || !canAccessSupplierSuborderInbox(role)) {
    throw new SupplierSuborderClientError("forbidden");
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function getErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function mapRpcError(error: unknown): SupplierSuborderClientError {
  switch (getErrorCode(error)) {
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

function isJsonObject(value: Json): value is { [key: string]: Json | undefined } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new SupplierSuborderClientError("operation_failed");
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null) return null;
  return requiredString(value);
}

function requiredInteger(value: unknown, minimum = 0): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum) {
    throw new SupplierSuborderClientError("operation_failed");
  }
  return value;
}

function validTimestamp(value: string | null): string | null {
  if (value === null) return null;
  if (!Number.isFinite(Date.parse(value))) {
    throw new SupplierSuborderClientError("operation_failed");
  }
  return value;
}

function requiredTimestamp(value: unknown): string {
  const timestamp = validTimestamp(requiredString(value));
  if (timestamp === null) throw new SupplierSuborderClientError("operation_failed");
  return timestamp;
}

function normalizeDecimal(value: string): string {
  const [integerPart = "0", fractionPart = ""] = value.split(".");
  const normalizedFraction = fractionPart.replace(/0+$/, "");
  const normalizedInteger = integerPart.replace(/^0+(?=\d)/, "");
  return normalizedFraction.length > 0
    ? `${normalizedInteger}.${normalizedFraction}`
    : normalizedInteger;
}

function decodeWorkflowLine(value: Json): SupplierSuborderWorkflow["lines"][number] {
  if (!isJsonObject(value)) throw new SupplierSuborderClientError("operation_failed");
  const packBaseUnit = requiredString(value.pack_base_unit);
  if (packBaseUnit !== "kg" && packBaseUnit !== "l" && packBaseUnit !== "piece") {
    throw new SupplierSuborderClientError("operation_failed");
  }
  const packAmount = requiredString(value.pack_amount);
  const priceAmount = requiredString(value.price_amount);
  if (
    !/^\d+(?:\.\d+)?$/.test(packAmount) ||
    !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(priceAmount) ||
    normalizeDecimal(priceAmount) === "0"
  ) {
    throw new SupplierSuborderClientError("operation_failed");
  }
  const buyerRequestLineId = requiredString(value.buyer_request_line_id);
  if (!isUuid(buyerRequestLineId))
    throw new SupplierSuborderClientError("operation_failed");
  return {
    buyerRequestLineId,
    title: requiredString(value.title),
    sellUnitLabel: requiredString(value.sell_unit_label),
    unitsPerSellUnit: requiredInteger(value.units_per_sell_unit, 1),
    packAmount,
    packBaseUnit,
    quantity: requiredInteger(value.quantity, 1),
    priceAmount,
    currency: requiredString(value.currency),
  };
}

export function decodeSupplierSuborderWorkflowRow(
  row: SupplierSuborderWorkflowRow,
): SupplierSuborderWorkflow {
  if (!isSupplierSuborderWorkflowStatus(row.status)) {
    throw new SupplierSuborderClientError("operation_failed");
  }
  if (!Array.isArray(row.lines))
    throw new SupplierSuborderClientError("operation_failed");
  const lines = row.lines.map(decodeWorkflowLine);
  if (lines.length === 0) throw new SupplierSuborderClientError("operation_failed");
  const seenLineIds = new Set<string>();
  for (const line of lines) {
    if (seenLineIds.has(line.buyerRequestLineId)) {
      throw new SupplierSuborderClientError("operation_failed");
    }
    seenLineIds.add(line.buyerRequestLineId);
  }
  const supplierSuborderId = requiredString(row.supplier_suborder_id);
  const workflowVersion = requiredInteger(row.workflow_version, 1);
  const currentTermsVersion = requiredInteger(row.current_terms_version, 1);
  if (!isUuid(supplierSuborderId) || currentTermsVersion > workflowVersion) {
    throw new SupplierSuborderClientError("operation_failed");
  }
  return {
    supplierSuborderId,
    status: row.status,
    workflowVersion,
    currentTermsVersion,
    termsReason: nullableString(row.terms_reason),
    responseDeadlineAt: validTimestamp(nullableString(row.response_deadline_at)),
    createdAt: requiredTimestamp(row.created_at),
    updatedAt: requiredTimestamp(row.updated_at),
    lines,
  };
}

function assertActionKeyAndVersion(
  workflow: SupplierSuborderWorkflow,
  idempotencyKey: string,
): void {
  if (!isUuid(workflow.supplierSuborderId) || !isUuid(idempotencyKey)) {
    throw new SupplierSuborderClientError("invalid_input");
  }
  requiredInteger(workflow.workflowVersion, 1);
}

function assertActionAllowed(
  workflow: SupplierSuborderWorkflow,
  action: "supplier_accept" | "supplier_reject" | "supplier_propose_version",
): void {
  if (!canApplySupplierSuborderWorkflowAction(workflow.status, action)) {
    throw new SupplierSuborderClientError("invalid_transition");
  }
}

function validateReason(reason: string): string {
  const normalized = reason.trim();
  if (normalized.length < 1 || normalized.length > 1000) {
    throw new SupplierSuborderClientError("invalid_input");
  }
  return normalized;
}

function validateProposal(
  workflow: SupplierSuborderWorkflow,
  reason: string,
  responseDeadlineAt: string,
  lines: readonly SupplierSuborderProposalDraftLine[],
): { reason: string; lines: readonly SupplierSuborderProposalDraftLine[] } {
  const normalizedReason = validateReason(reason);
  const parsedDeadline = Date.parse(responseDeadlineAt);
  if (!Number.isFinite(parsedDeadline) || parsedDeadline <= Date.now()) {
    throw new SupplierSuborderClientError("invalid_input");
  }
  if (lines.length !== workflow.lines.length) {
    throw new SupplierSuborderClientError("invalid_input");
  }
  const existingById = new Map(
    workflow.lines.map((line) => [line.buyerRequestLineId, line]),
  );
  const seenLineIds = new Set<string>();
  let changed = false;
  for (const line of lines) {
    const current = existingById.get(line.buyerRequestLineId);
    if (!current || seenLineIds.has(line.buyerRequestLineId)) {
      throw new SupplierSuborderClientError("invalid_input");
    }
    seenLineIds.add(line.buyerRequestLineId);
    if (
      !Number.isSafeInteger(line.quantity) ||
      line.quantity < 1 ||
      line.quantity > 1_000_000 ||
      !/^(?:0|[1-9]\d{0,11})(?:\.\d{1,4})?$/.test(line.priceAmount) ||
      normalizeDecimal(line.priceAmount) === "0"
    ) {
      throw new SupplierSuborderClientError("invalid_input");
    }
    changed ||=
      line.quantity !== current.quantity ||
      normalizeDecimal(line.priceAmount) !== normalizeDecimal(current.priceAmount);
  }
  if (!changed) throw new SupplierSuborderClientError("invalid_input");
  return { reason: normalizedReason, lines };
}

function decodeReceipt(
  value: Json,
  expectedSuborderId: string,
): SupplierSuborderWorkflowReceipt {
  if (!isJsonObject(value)) throw new SupplierSuborderClientError("operation_failed");
  const supplierSuborderId = requiredString(value.supplier_suborder_id);
  const status = requiredString(value.status);
  const workflowVersion = requiredInteger(value.workflow_version, 1);
  const currentTermsVersion = requiredInteger(value.current_terms_version, 1);
  const eventId = requiredString(value.event_id);
  if (
    supplierSuborderId !== expectedSuborderId ||
    !isUuid(eventId) ||
    !isSupplierSuborderWorkflowStatus(status) ||
    typeof value.replayed !== "boolean"
  ) {
    throw new SupplierSuborderClientError("operation_failed");
  }
  return {
    supplierSuborderId,
    status,
    workflowVersion,
    currentTermsVersion,
    eventId,
    replayed: value.replayed,
  };
}

export function newSupplierSuborderIdempotencyKey(): string {
  return crypto.randomUUID();
}

export async function listOwnSupplierSuborders(
  client: WorkspaceClient,
  organizationId: string,
  organizationType: OrganizationType,
  role: MembershipRole,
): Promise<readonly SupplierSuborderWorkflow[]> {
  assertSupplierAccess(organizationId, organizationType, role);
  const { data, error } = await client.rpc("list_supplier_suborders", {
    p_supplier_organization_id: organizationId,
  });
  if (error) throw mapRpcError(error);
  if (!data) throw new SupplierSuborderClientError("operation_failed");
  return data.map(decodeSupplierSuborderWorkflowRow);
}

export async function acceptOwnSupplierSuborder(
  client: WorkspaceClient,
  organizationId: string,
  organizationType: OrganizationType,
  role: MembershipRole,
  workflow: SupplierSuborderWorkflow,
  idempotencyKey: string,
): Promise<SupplierSuborderWorkflowReceipt> {
  assertSupplierAccess(organizationId, organizationType, role);
  assertActionAllowed(workflow, "supplier_accept");
  assertActionKeyAndVersion(workflow, idempotencyKey);
  const { data, error } = await client.rpc("accept_supplier_suborder", {
    p_supplier_organization_id: organizationId,
    p_supplier_suborder_id: workflow.supplierSuborderId,
    p_expected_version: workflow.workflowVersion,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw mapRpcError(error);
  if (!data) throw new SupplierSuborderClientError("operation_failed");
  return decodeReceipt(data, workflow.supplierSuborderId);
}

export async function rejectOwnSupplierSuborder(
  client: WorkspaceClient,
  organizationId: string,
  organizationType: OrganizationType,
  role: MembershipRole,
  workflow: SupplierSuborderWorkflow,
  reason: string,
  idempotencyKey: string,
): Promise<SupplierSuborderWorkflowReceipt> {
  assertSupplierAccess(organizationId, organizationType, role);
  assertActionAllowed(workflow, "supplier_reject");
  assertActionKeyAndVersion(workflow, idempotencyKey);
  const normalizedReason = validateReason(reason);
  const { data, error } = await client.rpc("reject_supplier_suborder", {
    p_supplier_organization_id: organizationId,
    p_supplier_suborder_id: workflow.supplierSuborderId,
    p_reason: normalizedReason,
    p_expected_version: workflow.workflowVersion,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw mapRpcError(error);
  if (!data) throw new SupplierSuborderClientError("operation_failed");
  return decodeReceipt(data, workflow.supplierSuborderId);
}

export async function proposeOwnSupplierSuborderVersion(
  client: WorkspaceClient,
  organizationId: string,
  organizationType: OrganizationType,
  role: MembershipRole,
  workflow: SupplierSuborderWorkflow,
  reason: string,
  responseDeadlineAt: string,
  lines: readonly SupplierSuborderProposalDraftLine[],
  idempotencyKey: string,
): Promise<SupplierSuborderWorkflowReceipt> {
  assertSupplierAccess(organizationId, organizationType, role);
  assertActionAllowed(workflow, "supplier_propose_version");
  assertActionKeyAndVersion(workflow, idempotencyKey);
  const validated = validateProposal(workflow, reason, responseDeadlineAt, lines);
  const rpcLines: Json[] = validated.lines.map((line) => ({
    buyer_request_line_id: line.buyerRequestLineId,
    quantity: line.quantity,
    price_amount: line.priceAmount,
  }));
  const { data, error } = await client.rpc("propose_supplier_suborder_version", {
    p_supplier_organization_id: organizationId,
    p_supplier_suborder_id: workflow.supplierSuborderId,
    p_reason: validated.reason,
    p_response_deadline_at: responseDeadlineAt,
    p_lines: rpcLines,
    p_expected_version: workflow.workflowVersion,
    p_idempotency_key: idempotencyKey,
  });
  if (error) throw mapRpcError(error);
  if (!data) throw new SupplierSuborderClientError("operation_failed");
  return decodeReceipt(data, workflow.supplierSuborderId);
}

export function supplierSuborderClientErrorMessage(error: unknown): string {
  if (!(error instanceof SupplierSuborderClientError)) {
    return "Не удалось выполнить запрос. Проверьте подключение и повторите попытку.";
  }
  switch (error.code) {
    case "invalid_input":
      return "Проверьте заполненные данные и срок ответа.";
    case "forbidden":
      return "У этой роли нет доступа к подзаказам данной организации.";
    case "not_found":
      return "Подзаказ больше недоступен. Обновите список.";
    case "version_conflict":
      return "Данные подзаказа изменились. Обновите список перед следующим действием.";
    case "idempotency_conflict":
      return "Повтор действия не совпал с исходным запросом. Обновите список и повторите.";
    case "invalid_transition":
      return "Действие недоступно для текущего состояния подзаказа. Обновите список.";
    case "operation_failed":
      return "Не удалось выполнить действие. Обновите данные и проверьте подключение.";
  }
}

export function isSupplierSuborderStaleConflict(error: unknown): boolean {
  return (
    error instanceof SupplierSuborderClientError &&
    (error.code === "version_conflict" || error.code === "invalid_transition")
  );
}

export type SupplierSuborderStatusLabel = Readonly<
  Record<SupplierSuborderWorkflowStatus, string>
>;

export const SUPPLIER_SUBORDER_STATUS_LABELS: SupplierSuborderStatusLabel = {
  awaiting_supplier: "Ожидает ответа поставщика",
  supplier_accepted: "Поставщик принял условия",
  supplier_rejected: "Поставщик отклонил условия",
  awaiting_buyer_decision: "Ожидает решения покупателя",
  buyer_accepted: "Покупатель принял предложенные условия",
  buyer_rejected: "Покупатель отклонил предложенные условия",
};
