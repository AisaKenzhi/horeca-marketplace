import { describe, expect, it } from "vitest";
import {
  canAccessBuyerOrg,
  canAccessSupplier,
  canEditSupplierCatalog,
  canManageProcurement,
  canModerateContent,
  canRecordReceiving,
  canRespondToSuborder,
  canViewSuborder,
  operatorCanEditOrderTerms,
  visibleSubordersForBuyer,
  visibleSubordersForSupplier,
} from "@/domain/authorization";
import {
  buyerOwner,
  buyerViewer,
  demoLocation,
  demoOrg,
  makeSuborder,
  platformModerator,
  supplierAlpha,
  supplierAlphaOperator,
  supplierBeta,
  supplierBetaOperator,
} from "../../tests/fixtures";
import { asOrgId } from "@/domain/ids";

const locationsById = new Map([[demoLocation.id, demoLocation]]);

describe("buyer tenant isolation", () => {
  it("only allows access to the membership's own buyer org", () => {
    expect(canAccessBuyerOrg(buyerOwner, demoOrg.id)).toBe(true);
    expect(canAccessBuyerOrg(buyerOwner, asOrgId("org-other"))).toBe(false);
  });

  it("does not let a supplier membership act as a buyer org", () => {
    expect(canAccessBuyerOrg(supplierAlphaOperator, demoOrg.id)).toBe(false);
  });

  it("restricts management to owner/admin/buyer, not viewer", () => {
    expect(canManageProcurement(buyerOwner, demoOrg.id)).toBe(true);
    expect(canManageProcurement(buyerViewer, demoOrg.id)).toBe(false);
  });

  it("lets receivers record receiving but not manage terms", () => {
    const receiver = { ...buyerOwner, role: "receiver" as const };
    expect(canRecordReceiving(receiver, demoOrg.id)).toBe(true);
    expect(canManageProcurement(receiver, demoOrg.id)).toBe(false);
  });

  it("filters out suborders from another buyer org", () => {
    const otherOrgSub = makeSuborder({ orgId: asOrgId("org-other") });
    const visible = visibleSubordersForBuyer(
      buyerOwner,
      [makeSuborder(), otherOrgSub],
      locationsById,
    );
    expect(visible).toHaveLength(1);
  });
});

describe("supplier isolation", () => {
  it("only allows access to the membership's own supplier", () => {
    expect(canAccessSupplier(supplierAlphaOperator, supplierAlpha.id)).toBe(true);
    expect(canAccessSupplier(supplierAlphaOperator, supplierBeta.id)).toBe(false);
  });

  it("lets a supplier see only its own suborders", () => {
    const alphaSub = makeSuborder({ supplierId: supplierAlpha.id });
    const betaSub = makeSuborder({ supplierId: supplierBeta.id });
    const visible = visibleSubordersForSupplier(supplierAlphaOperator, [
      alphaSub,
      betaSub,
    ]);
    expect(visible).toHaveLength(1);
    expect(visible[0]!.supplierId).toBe(supplierAlpha.id);
  });

  it("NEVER lets a supplier read a sibling supplier's suborder", () => {
    const betaSub = makeSuborder({ supplierId: supplierBeta.id });
    expect(canViewSuborder(supplierAlphaOperator, betaSub, demoLocation)).toBe(false);
    expect(canViewSuborder(supplierBetaOperator, betaSub, demoLocation)).toBe(true);
  });

  it("does not let a supplier read a buyer suborder at all (data isolation)", () => {
    const unrelated = makeSuborder({
      orgId: asOrgId("org-other"),
      supplierId: supplierBeta.id,
    });
    expect(canViewSuborder(supplierAlphaOperator, unrelated, demoLocation)).toBe(false);
  });

  it("keeps catalog editing separate from order responding", () => {
    const catalogOnly = { ...supplierAlphaOperator, role: "catalog_operator" as const };
    expect(canEditSupplierCatalog(catalogOnly, supplierAlpha.id)).toBe(true);
    expect(canRespondToSuborder(catalogOnly, supplierAlpha.id)).toBe(false);

    const ordersOnly = { ...supplierAlphaOperator, role: "order_operator" as const };
    expect(canEditSupplierCatalog(ordersOnly, supplierAlpha.id)).toBe(false);
    expect(canRespondToSuborder(ordersOnly, supplierAlpha.id)).toBe(true);
  });
});

describe("operator scope", () => {
  it("lets a moderator do read-only moderation", () => {
    expect(canModerateContent(platformModerator)).toBe(true);
  });

  it("never lets an operator edit order terms", () => {
    expect(operatorCanEditOrderTerms()).toBe(false);
  });

  it("does not let an operator read a buyer's suborder directly", () => {
    // Operator views operate on synthetic demo queues, not real suborder reads.
    expect(canViewSuborder(platformModerator, makeSuborder(), demoLocation)).toBe(false);
  });
});
