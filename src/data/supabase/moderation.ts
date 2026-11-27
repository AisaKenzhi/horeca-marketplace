/**
 * Client adapter for the local platform-moderation capability.
 * Authorization is decided by trusted RPC in the database; this module only
 * surfaces a safe verdict and typed errors. It never grants a role.
 */
import type { WorkspaceClient } from "./workspace";

export type ModerationErrorCode =
  "forbidden" | "not_found" | "invalid_input" | "invalid_transition" | "operation_failed";

export class ModerationError extends Error {
  constructor(readonly code: ModerationErrorCode) {
    super(code);
    this.name = "ModerationError";
  }
}

export interface PendingSupplierProfile {
  readonly organizationId: string;
  readonly displayName: string;
  readonly verificationStatus: string;
  readonly createdAt: string;
}

export interface ModerationAdapter {
  isModerator(client: WorkspaceClient): Promise<boolean>;
  listPending(client: WorkspaceClient): Promise<readonly PendingSupplierProfile[]>;
  decide(
    client: WorkspaceClient,
    organizationId: string,
    decision: "approve" | "reject",
    reason: string,
  ): Promise<string>;
}

function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

function mapError(error: unknown): ModerationError {
  switch (errorCode(error)) {
    case "42501":
      return new ModerationError("forbidden");
    case "P0002":
    case "PGRST116":
      return new ModerationError("not_found");
    case "23514":
    case "22P02":
      return new ModerationError("invalid_input");
    case "55000":
      return new ModerationError("invalid_transition");
    default:
      return new ModerationError("operation_failed");
  }
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function requiredString(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ModerationError("operation_failed");
  }
  return value;
}

export function moderationErrorMessage(error: unknown): string {
  if (!(error instanceof ModerationError)) {
    return "Не удалось выполнить действие. Проверьте подключение и попробуйте позже.";
  }
  switch (error.code) {
    case "forbidden":
      return "У этой учётной записи нет полномочий модератора.";
    case "not_found":
      return "Профиль больше недоступен. Обновите список.";
    case "invalid_input":
      return "Проверьте решение и причину (от 1 до 1000 символов).";
    case "invalid_transition":
      return "Профиль уже рассмотрен. Обновите список.";
    case "operation_failed":
      return "Не удалось выполнить действие. Обновите данные и попробуйте позже.";
  }
}

export const moderationAdapter: ModerationAdapter = {
  async isModerator(client) {
    const { data, error } = await client.rpc("is_platform_moderator", {});
    if (error) throw mapError(error);
    if (typeof data !== "boolean") throw new ModerationError("operation_failed");
    return data;
  },

  async listPending(client) {
    const { data, error } = await client.rpc("list_pending_supplier_profiles", {});
    if (error) throw mapError(error);
    if (!data) throw new ModerationError("operation_failed");
    return data.map((row) => ({
      organizationId: requiredString(row.organization_id),
      displayName: requiredString(row.display_name),
      verificationStatus: requiredString(row.verification_status),
      createdAt: requiredString(row.created_at),
    }));
  },

  async decide(client, organizationId, decision, reason) {
    if (!isUuid(organizationId) || (decision !== "approve" && decision !== "reject")) {
      throw new ModerationError("invalid_input");
    }
    const normalized = reason.trim();
    if (normalized.length < 1 || normalized.length > 1000) {
      throw new ModerationError("invalid_input");
    }
    const { data, error } = await client.rpc("decide_supplier_verification", {
      p_organization_id: organizationId,
      p_decision: decision,
      p_reason: normalized,
    });
    if (error) throw mapError(error);
    if (typeof data !== "string" || !isUuid(data)) {
      throw new ModerationError("operation_failed");
    }
    return data;
  },
};
