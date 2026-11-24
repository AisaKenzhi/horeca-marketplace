import { describe, expect, it } from "vitest";
import {
  AppError,
  conflictError,
  forbiddenError,
  isRetryable,
  notFoundError,
  staleDataError,
  toSafeError,
  unavailableError,
  validationError,
  RETRYABLE_CODES,
  type ErrorCode,
} from "@/domain/errors";
import { money } from "@/domain/money";
import { assertSuborderTransition } from "@/domain/orderLifecycle";
import { proposeSupplierRevision, type RevisionLineInput } from "@/domain/revisions";
import type { SupplierSuborder } from "@/domain/entities";
import {
  asBuyerLocationId,
  asIso,
  asOrgId,
  asProcurementId,
  asRevisionId,
  asSuborderId,
  asSupplierId,
} from "@/domain/ids";

describe("error catalogue", () => {
  it("creates a typed error with a stable code and safe message", () => {
    const e = validationError("Количество неверно.");
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe("validation");
    expect(e.message).toBe("Количество неверно.");
  });

  it("drops internal detail from toSafeError for a non-AppError", () => {
    // A raw Error could contain anything; the user must only see the safe text.
    const safe = toSafeError(new Error("SELECT * FROM secret_table at /app/db.ts:42"));
    expect(safe.code).toBe("internal");
    expect(safe.message).not.toContain("SELECT");
    expect(safe.message).not.toContain("db.ts");
  });

  it("uses the default Russian messages for each factory", () => {
    expect(validationError("x").code).toBe("validation");
    expect(forbiddenError().code).toBe("forbidden");
    expect(notFoundError().code).toBe("not_found");
    expect(staleDataError().code).toBe("stale_data");
    expect(conflictError().code).toBe("conflict");
    expect(unavailableError().code).toBe("unavailable");
  });

  it("carries nextStep and context when provided, and passes them through toSafeError", () => {
    const e = conflictError("Данные изменились.", {
      nextStep: "Перечитайте и повторите.",
      context: { entity: "suborder" },
    });
    expect(e.nextStep).toBe("Перечитайте и повторите.");
    expect(e.context).toEqual({ entity: "suborder" });
    const safe = toSafeError(e);
    expect(safe.code).toBe("conflict");
    expect(safe.message).toBe("Данные изменились.");
    expect(safe.nextStep).toBe("Перечитайте и повторите.");
  });

  it("omits nextStep from toSafeError when it was not set", () => {
    const safe = toSafeError(notFoundError("Нет."));
    expect(safe).toEqual({ code: "not_found", message: "Нет." });
    expect("nextStep" in safe).toBe(false);
  });

  it("only treats transient/idempotent codes as retryable", () => {
    const retryable: ErrorCode[] = ["transient_network", "rate_limited", "internal"];
    const notRetryable: ErrorCode[] = [
      "validation",
      "forbidden",
      "not_found",
      "stale_data",
      "conflict",
      "unavailable",
    ];
    for (const c of retryable) expect(isRetryable(c)).toBe(true);
    for (const c of notRetryable) expect(isRetryable(c)).toBe(false);
    expect(RETRYABLE_CODES).toEqual(retryable);
  });
});

describe("domain failures keep their typed code", () => {
  function codeOf(fn: () => unknown): ErrorCode | undefined {
    try {
      fn();
    } catch (e) {
      return toSafeError(e).code;
    }
    return undefined;
  }

  it("money rejects non-safe-integer amounts as validation, not internal", () => {
    expect(codeOf(() => money(1.5))).toBe("validation");
    expect(codeOf(() => money(Number.MAX_SAFE_INTEGER + 1))).toBe("validation");
  });

  it("illegal lifecycle transitions are conflicts", () => {
    expect(codeOf(() => assertSuborderTransition("confirmed", "draft"))).toBe("conflict");
  });

  it("a foreign supplier cannot propose a change; impossible values are validation errors", () => {
    const nowIso = "2026-11-19T12:00:00.000Z";
    const suborder: SupplierSuborder = {
      id: asSuborderId("sub-1"),
      procurementId: asProcurementId("proc-1"),
      supplierId: asSupplierId("sup-1"),
      orgId: asOrgId("org-1"),
      locationId: asBuyerLocationId("loc-1"),
      status: "awaiting_supplier",
      fulfillmentStatus: "not_started",
      paymentStatus: "not_processed",
      confirmedLines: null,
      currentRevisionId: asRevisionId("rev-0"),
      createdAt: asIso(nowIso),
      updatedAt: asIso(nowIso),
      version: 1,
    };
    const line: RevisionLineInput = {
      offerId: "offer-1",
      changeKind: "price_changed",
      quantityBefore: 1,
      quantityAfter: 1,
      priceBefore: money(100),
      priceAfter: money(120),
      sellUnitLabelBefore: "шт",
      sellUnitLabelAfter: "шт",
      substitutedFromOfferId: null,
      substitutedToOfferId: null,
      reasonDemo: "демо",
    };
    const base = {
      suborder,
      lines: [line],
      deliveryWindowDemo: null,
      nowIso,
      nextRevisionNumber: 1,
    };
    expect(
      codeOf(() =>
        proposeSupplierRevision({ ...base, supplierId: asSupplierId("sup-2") }),
      ),
    ).toBe("forbidden");
    expect(
      codeOf(() =>
        proposeSupplierRevision({
          ...base,
          supplierId: suborder.supplierId,
          lines: [{ ...line, priceAfter: money(-1) }],
        }),
      ),
    ).toBe("validation");
  });
});
