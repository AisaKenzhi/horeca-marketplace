import { describe, expect, it } from "vitest";
import {
  canApplySupplierSuborderWorkflowAction,
  hasResponseDeadlineElapsed,
  isCurrentSupplierSuborderTermsVersion,
  SUPPLIER_RESPONSE_DEADLINE_NOTICE,
  isSupplierSuborderWorkflowStatus,
  SUPPLIER_SUBORDER_WORKFLOW_STATUSES,
  type SupplierSuborderWorkflowStatus,
} from "./supplierSuborderWorkflow";

describe("supplier suborder workflow contract", () => {
  it("recognizes only the persisted workflow statuses", () => {
    for (const status of SUPPLIER_SUBORDER_WORKFLOW_STATUSES) {
      expect(isSupplierSuborderWorkflowStatus(status)).toBe(true);
    }
    expect(isSupplierSuborderWorkflowStatus("accepted")).toBe(false);
    expect(isSupplierSuborderWorkflowStatus(null)).toBe(false);
  });

  it("allows only explicit supplier or buyer actions for the current state", () => {
    const expected: Readonly<Record<SupplierSuborderWorkflowStatus, readonly string[]>> =
      {
        awaiting_supplier: [
          "supplier_accept",
          "supplier_reject",
          "supplier_propose_version",
        ],
        supplier_accepted: [],
        supplier_rejected: [],
        awaiting_buyer_decision: ["buyer_accept_version", "buyer_reject_version"],
        buyer_accepted: [],
        buyer_rejected: [],
      };

    for (const status of SUPPLIER_SUBORDER_WORKFLOW_STATUSES) {
      for (const action of [
        "supplier_accept",
        "supplier_reject",
        "supplier_propose_version",
        "buyer_accept_version",
        "buyer_reject_version",
      ] as const) {
        expect(canApplySupplierSuborderWorkflowAction(status, action)).toBe(
          expected[status].includes(action),
        );
      }
    }
  });

  it("requires a buyer decision to target the exact current proposed version", () => {
    const pendingBuyerDecision = {
      status: "awaiting_buyer_decision" as const,
      currentTermsVersion: 2,
    };
    expect(isCurrentSupplierSuborderTermsVersion(pendingBuyerDecision, 2)).toBe(true);
    expect(isCurrentSupplierSuborderTermsVersion(pendingBuyerDecision, 1)).toBe(false);
    expect(isCurrentSupplierSuborderTermsVersion(pendingBuyerDecision, 3)).toBe(false);
    expect(
      isCurrentSupplierSuborderTermsVersion(
        { status: "awaiting_supplier", currentTermsVersion: 1 },
        1,
      ),
    ).toBe(false);
    expect(isCurrentSupplierSuborderTermsVersion(pendingBuyerDecision, 2.5)).toBe(false);
  });
});

describe("response deadline (local informational-only default)", () => {
  it("reports elapsed deadlines without treating silence as consent", () => {
    const now = "2026-11-26T12:00:00.000Z";
    expect(hasResponseDeadlineElapsed("2026-11-25T12:00:00.000Z", now)).toBe(true);
    expect(hasResponseDeadlineElapsed("2026-11-27T12:00:00.000Z", now)).toBe(false);
    expect(hasResponseDeadlineElapsed(null, now)).toBe(false);
    expect(hasResponseDeadlineElapsed("not-a-timestamp", now)).toBe(false);
  });

  it("keeps allowed transitions independent of elapsed time", () => {
    const status: SupplierSuborderWorkflowStatus = "awaiting_buyer_decision";
    expect(canApplySupplierSuborderWorkflowAction(status, "buyer_accept_version")).toBe(
      true,
    );
    expect(canApplySupplierSuborderWorkflowAction(status, "supplier_accept")).toBe(false);
    expect(SUPPLIER_RESPONSE_DEADLINE_NOTICE).toContain("не означает согласия");
  });
});
