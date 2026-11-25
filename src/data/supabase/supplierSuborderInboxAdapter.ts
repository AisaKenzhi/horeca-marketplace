import type {
  SupplierSuborderWorkflow,
  SupplierSuborderWorkflowReceipt,
} from "@/domain/supplierSuborderWorkflow";
import type { MembershipRole, OrganizationType } from "./database.types";
import type { WorkspaceClient } from "./workspace";
import {
  acceptOwnSupplierSuborder,
  listOwnSupplierSuborders,
  proposeOwnSupplierSuborderVersion,
  rejectOwnSupplierSuborder,
  type SupplierSuborderProposalDraftLine,
} from "./supplierSuborders";

export interface SupplierSuborderInboxScope {
  readonly organizationId: string;
  readonly organizationType: OrganizationType;
  readonly role: MembershipRole;
}

export interface SupplierSuborderInboxAdapter {
  list(
    client: WorkspaceClient,
    scope: SupplierSuborderInboxScope,
  ): Promise<readonly SupplierSuborderWorkflow[]>;
  accept(
    client: WorkspaceClient,
    scope: SupplierSuborderInboxScope,
    workflow: SupplierSuborderWorkflow,
    idempotencyKey: string,
  ): Promise<SupplierSuborderWorkflowReceipt>;
  reject(
    client: WorkspaceClient,
    scope: SupplierSuborderInboxScope,
    workflow: SupplierSuborderWorkflow,
    reason: string,
    idempotencyKey: string,
  ): Promise<SupplierSuborderWorkflowReceipt>;
  propose(
    client: WorkspaceClient,
    scope: SupplierSuborderInboxScope,
    workflow: SupplierSuborderWorkflow,
    reason: string,
    responseDeadlineAt: string,
    lines: readonly SupplierSuborderProposalDraftLine[],
    idempotencyKey: string,
  ): Promise<SupplierSuborderWorkflowReceipt>;
}

export const supplierSuborderInboxAdapter: SupplierSuborderInboxAdapter = {
  list: (client, scope) =>
    listOwnSupplierSuborders(
      client,
      scope.organizationId,
      scope.organizationType,
      scope.role,
    ),
  accept: (client, scope, workflow, idempotencyKey) =>
    acceptOwnSupplierSuborder(
      client,
      scope.organizationId,
      scope.organizationType,
      scope.role,
      workflow,
      idempotencyKey,
    ),
  reject: (client, scope, workflow, reason, idempotencyKey) =>
    rejectOwnSupplierSuborder(
      client,
      scope.organizationId,
      scope.organizationType,
      scope.role,
      workflow,
      reason,
      idempotencyKey,
    ),
  propose: (client, scope, workflow, reason, responseDeadlineAt, lines, idempotencyKey) =>
    proposeOwnSupplierSuborderVersion(
      client,
      scope.organizationId,
      scope.organizationType,
      scope.role,
      workflow,
      reason,
      responseDeadlineAt,
      lines,
      idempotencyKey,
    ),
};
