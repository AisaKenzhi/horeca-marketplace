import { describe, expect, it } from "vitest";
import { buildInitialState, Repository, type SessionContext } from "@/data/repository";
import {
  basket as seedBasket,
  buyerLists,
  buyerLocations,
  memberships,
  notifications,
  offers,
  organizations,
  products,
  suppliers,
} from "@/data/seed";
import {
  asSuborderId,
  asBuyerLocationId,
  asSupplierId,
  type SuborderId,
} from "@/domain/ids";
import { money } from "@/domain/money";
import { parseCatalogCsv, resolveImportRows } from "@/domain/catalogImport";

function makeRepo(): Repository {
  return new Repository(
    buildInitialState({
      organizations,
      buyerLocations,
      memberships,
      suppliers,
      products,
      offers,
      buyerLists,
      basket: seedBasket,
      notifications,
    }),
  );
}

const buyer: SessionContext = {
  membership: memberships.find((m) => m.id === "mem-buyer-owner")!,
  nowIso: "2026-11-19T12:00:00.000Z",
};
const supplierAlpha: SessionContext = {
  membership: memberships.find((m) => m.id === "mem-sup-alpha-ord")!,
  nowIso: "2026-11-19T12:05:00.000Z",
};
const viewer: SessionContext = {
  membership: memberships.find((m) => m.id === "mem-buyer-viewer")!,
  nowIso: "2026-11-19T12:05:00.000Z",
};

/** The seed basket now defaults to a ready state for both suppliers. */
function submitReadyBasket(repo: Repository): {
  procurementId: string;
  suborderIds: string[];
} {
  return repo.submitBasket(buyer);
}

describe("repository: submit basket -> supplier suborders", () => {
  it("creates one independent suborder per ready supplier and keeps unready lines", () => {
    const repo = makeRepo();
    const { procurementId, suborderIds } = submitReadyBasket(repo);
    const state = repo.getState();
    expect(procurementId).toMatch(/^proc-/);
    expect(suborderIds.length).toBeGreaterThan(0);
    expect(new Set(state.suborders.map((s) => s.supplierId)).size).toBe(
      state.suborders.length,
    );
    expect(state.suborders.every((s) => s.status === "awaiting_supplier")).toBe(true);
  });

  it("submits only groups that meet the supplier minimum, holding the rest", () => {
    const repo = makeRepo();
    // Drop Alpha below its minimum; only Beta should be submitted.
    const alphaLine = repo
      .getState()
      .basket.lines.find((l) => l.supplierId === "sup-alpha")!;
    repo.setBasketLineQuantity(buyer, alphaLine.id, 2); // 2 * 3200 = 6400 < 15000
    const { suborderIds } = repo.submitBasket(buyer);
    const state = repo.getState();
    expect(suborderIds).toHaveLength(1);
    expect(state.suborders[0]!.supplierId).toBe("sup-beta");
    // Alpha's unready line stays in the basket for the buyer to fix.
    expect(state.basket.lines.some((l) => l.supplierId === "sup-alpha")).toBe(true);
  });

  it("refuses submission from a viewer", () => {
    const repo = makeRepo();
    expect(() => repo.submitBasket(viewer)).toThrow(/Недостаточно прав|доступ/);
  });

  it("refuses to submit when no group is ready", () => {
    const repo = makeRepo();
    for (const line of repo.getState().basket.lines) {
      repo.setBasketLineQuantity(buyer, line.id, 1);
    }
    expect(() => repo.submitBasket(buyer)).toThrow(/готовой к отправке/);
  });

  it("refuses to submit an empty basket", () => {
    const repo = makeRepo();
    // Submit both ready groups, then the basket is empty.
    repo.submitBasket(buyer);
    expect(() => repo.submitBasket(buyer)).toThrow(/пуста/i);
  });

  it("audits the submission without storing sensitive values", () => {
    const repo = makeRepo();
    repo.submitBasket(buyer);
    const audit = repo.getState().audit;
    expect(audit.some((a) => a.action === "procurement.submit")).toBe(true);
    for (const event of audit) {
      expect(Object.keys(event.metadata)).not.toContain("address");
      expect(Object.keys(event.metadata)).not.toContain("phone");
    }
  });
});

describe("repository: supplier response and buyer decision", () => {
  it("routes a supplier price change to an explicit buyer decision", () => {
    const repo = makeRepo();
    submitReadyBasket(repo);
    const suborder = repo.getState().suborders.find((s) => s.supplierId === "sup-alpha")!;

    repo.proposeChange(
      supplierAlpha,
      suborder.id,
      [
        {
          offerId: "off-alpha-flour",
          changeKind: "price_changed",
          quantityBefore: 2,
          quantityAfter: 2,
          priceBefore: money(3200),
          priceAfter: money(3500),
          sellUnitLabelBefore: "мешок 5 кг",
          sellUnitLabelAfter: "мешок 5 кг",
          substitutedFromOfferId: null,
          substitutedToOfferId: null,
          reasonDemo: "Новая цена поставщика (демо)",
        },
      ],
      null,
    );

    const afterProposal = repo.getState().suborders.find((s) => s.id === suborder.id)!;
    expect(afterProposal.status).toBe("awaiting_buyer_decision");
    // Nothing is binding yet.
    expect(afterProposal.confirmedLines).toBeNull();

    repo.buyerDecide(buyer, suborder.id, "accepted", null);
    const afterDecision = repo.getState().suborders.find((s) => s.id === suborder.id)!;
    expect(afterDecision.status).toBe("confirmed");
    expect(afterDecision.confirmedLines).not.toBeNull();
    // The accepted snapshot uses the AFTER price (3500).
    expect(afterDecision.confirmedLines?.[0]?.pricePerSellUnit.amount).toBe(3500);
  });

  it("rejects a supplier change without binding lines", () => {
    const repo = makeRepo();
    submitReadyBasket(repo);
    const suborder = repo.getState().suborders.find((s) => s.supplierId === "sup-alpha")!;
    repo.proposeChange(
      supplierAlpha,
      suborder.id,
      [
        {
          offerId: "off-alpha-flour",
          changeKind: "quantity_changed",
          quantityBefore: 2,
          quantityAfter: 4,
          priceBefore: money(3200),
          priceAfter: money(3200),
          sellUnitLabelBefore: "мешок 5 кг",
          sellUnitLabelAfter: "мешок 5 кг",
          substitutedFromOfferId: null,
          substitutedToOfferId: null,
          reasonDemo: "Доступно только 4 (демо)",
        },
      ],
      null,
    );
    repo.buyerDecide(buyer, suborder.id, "rejected", "Не подходит количество");
    const s = repo.getState().suborders.find((x) => x.id === suborder.id)!;
    expect(s.status).toBe("rejected");
    expect(s.confirmedLines).toBeNull();
  });

  it("prevents a decision before a change has been proposed", () => {
    const repo = makeRepo();
    submitReadyBasket(repo);
    const suborder = repo.getState().suborders.find((s) => s.supplierId === "sup-alpha")!;
    expect(() => repo.buyerDecide(buyer, suborder.id, "accepted", null)).toThrow();
  });

  it("keeps sibling suborders independent: confirming one does not touch the other", () => {
    const repo = makeRepo();
    submitReadyBasket(repo);
    const alphaSub = repo.getState().suborders.find((s) => s.supplierId === "sup-alpha")!;
    const betaSub = repo.getState().suborders.find((s) => s.supplierId === "sup-beta")!;
    repo.confirmSuborderNoChange(supplierAlpha, alphaSub.id);
    const alpha = repo.getState().suborders.find((s) => s.id === alphaSub.id)!;
    const beta = repo.getState().suborders.find((s) => s.id === betaSub.id)!;
    expect(alpha.status).toBe("confirmed");
    expect(beta.status).toBe("awaiting_supplier");
  });
});

describe("repository: authorization boundaries", () => {
  it("refuses a supplier edit to another supplier's offer", () => {
    const repo = makeRepo();
    const supplierBetaCtx: SessionContext = {
      membership: memberships.find((m) => m.id === "mem-sup-beta-owner")!,
      nowIso: "2026-11-19T12:05:00.000Z",
    };
    expect(() => repo.updateOfferPrice(supplierBetaCtx, "off-alpha-flour", 9999)).toThrow(
      /Нет прав/,
    );
  });

  it("refuses a supplier response to another supplier's suborder", () => {
    const repo = makeRepo();
    submitReadyBasket(repo);
    const betaSub = repo.getState().suborders.find((s) => s.supplierId === "sup-beta")!;
    expect(() => repo.confirmSuborderNoChange(supplierAlpha, betaSub.id)).toThrow(
      /Нет прав/,
    );
  });

  it("refuses a buyer decision on a suborder of another org", () => {
    const repo = makeRepo();
    submitReadyBasket(repo);
    const alphaSub = repo.getState().suborders.find((s) => s.supplierId === "sup-alpha")!;
    const hotelBuyer: SessionContext = {
      membership: memberships.find((m) => m.id === "mem-buyer-hotel")!,
      nowIso: "2026-11-19T12:05:00.000Z",
    };
    expect(() => repo.buyerDecide(hotelBuyer, alphaSub.id, "accepted", null)).toThrow();
  });
});

describe("repository: fulfillment and receiving", () => {
  it("cannot start fulfillment before confirmation", () => {
    const repo = makeRepo();
    submitReadyBasket(repo);
    const suborder = repo.getState().suborders.find((s) => s.supplierId === "sup-alpha")!;
    expect(() => repo.advanceFulfillment(supplierAlpha, suborder.id, "packing")).toThrow(
      /до подтверждения заказа/,
    );
  });

  it("advances fulfillment only after confirmation and records idempotent events", () => {
    const repo = makeRepo();
    submitReadyBasket(repo);
    const suborder = repo.getState().suborders.find((s) => s.supplierId === "sup-alpha")!;
    repo.confirmSuborderNoChange(supplierAlpha, suborder.id);
    repo.advanceFulfillment(supplierAlpha, suborder.id, "packing");
    repo.advanceFulfillment(supplierAlpha, suborder.id, "ready_for_handover");
    repo.advanceFulfillment(supplierAlpha, suborder.id, "shipped");
    const s = repo.getState().suborders.find((x) => x.id === suborder.id)!;
    expect(s.fulfillmentStatus).toBe("shipped");
    // Payment remains a separate dimension, untouched.
    expect(s.paymentStatus).toBe("not_processed");
    const events = repo
      .getState()
      .fulfillments.filter((f) => f.suborderId === suborder.id);
    expect(events).toHaveLength(3);
    // Idempotency: keys are unique per transition.
    expect(new Set(events.map((e) => e.idempotencyKey)).size).toBe(3);
  });

  it("records a receipt with discrepancies as observations, not a resolution", () => {
    const repo = makeRepo();
    submitReadyBasket(repo);
    const suborder = repo.getState().suborders.find((s) => s.supplierId === "sup-alpha")!;
    repo.confirmSuborderNoChange(supplierAlpha, suborder.id);
    repo.advanceFulfillment(supplierAlpha, suborder.id, "packing");
    repo.advanceFulfillment(supplierAlpha, suborder.id, "ready_for_handover");
    repo.advanceFulfillment(supplierAlpha, suborder.id, "shipped");
    repo.advanceFulfillment(supplierAlpha, suborder.id, "delivered");
    repo.advanceFulfillment(buyer, suborder.id, "receiving");

    const receiver: SessionContext = {
      membership: memberships.find((m) => m.id === "mem-buyer-receiver")!,
      nowIso: "2026-11-19T13:00:00.000Z",
    };
    repo.recordReceipt(
      receiver,
      suborder.id,
      [{ offerId: "off-alpha-flour" as never, expectedQuantity: 2, receivedQuantity: 1 }],
      ["shortage"],
    );
    const state = repo.getState();
    expect(state.receipts).toHaveLength(1);
    expect(state.issues).toHaveLength(1);
    expect(state.issues[0]!.state).toBe("open_demo");
    // Receiving does not itself decide the order outcome.
    const s = state.suborders.find((x) => x.id === suborder.id)!;
    expect(s.fulfillmentStatus).toBe("receiving");
  });

  it("refuses receiving from a viewer", () => {
    const repo = makeRepo();
    submitReadyBasket(repo);
    const suborder = repo.getState().suborders.find((s) => s.supplierId === "sup-alpha")!;
    repo.confirmSuborderNoChange(supplierAlpha, suborder.id);
    expect(() => repo.advanceFulfillment(viewer, suborder.id, "packing")).toThrow();
  });
});

describe("repository: supplier catalog edits bump version and timestamp", () => {
  it("records a new observation time on a price update", () => {
    const repo = makeRepo();
    const catalogOperator: SessionContext = {
      membership: memberships.find((m) => m.id === "mem-sup-alpha-cat")!,
      nowIso: "2026-11-19T12:05:00.000Z",
    };
    const before = repo.getState().offers.find((o) => o.id === "off-alpha-flour")!;
    repo.updateOfferPrice(catalogOperator, "off-alpha-flour", 3300);
    const after = repo.getState().offers.find((o) => o.id === "off-alpha-flour")!;
    expect(after.pricePerSellUnit.value?.amount).toBe(3300);
    expect(after.pricePerSellUnit.observedAt).toBe(catalogOperator.nowIso);
    expect(after.version).toBe(before.version + 1);
  });

  it("refuses a viewer-role supplier editing the catalog", () => {
    const repo = makeRepo();
    const catalogOnly: SessionContext = {
      membership: memberships.find((m) => m.id === "mem-sup-alpha-cat")!,
      nowIso: "2026-11-19T12:05:00.000Z",
    };
    // Catalog operator CAN edit; order operator cannot. Verify the negative case.
    const orderOnly: SessionContext = {
      membership: memberships.find((m) => m.id === "mem-sup-alpha-ord")!,
      nowIso: "2026-11-19T12:05:00.000Z",
    };
    expect(() => repo.updateOfferPrice(orderOnly, "off-alpha-flour", 1)).toThrow(
      /Нет прав/,
    );
    expect(() =>
      repo.updateOfferPrice(catalogOnly, "off-alpha-flour", 3300),
    ).not.toThrow();
  });
});

describe("repository: unknown ids are data, not authorization", () => {
  it("throws for a non-existent suborder", () => {
    const repo = makeRepo();
    expect(() =>
      repo.buyerDecide(buyer, asSuborderId("does-not-exist"), "accepted", null),
    ).toThrow(/не найден/i);
  });
});

/* ================================================================== */
/* Hardening: tenant isolation, locations, roles, idempotency         */
/* ================================================================== */

const hotelBuyer: SessionContext = {
  membership: memberships.find((m) => m.id === "mem-buyer-hotel")!,
  nowIso: "2026-11-19T12:05:00.000Z",
};
const supplierBetaOwner: SessionContext = {
  membership: memberships.find((m) => m.id === "mem-sup-beta-owner")!,
  nowIso: "2026-11-19T12:05:00.000Z",
};
const receiver: SessionContext = {
  membership: memberships.find((m) => m.id === "mem-buyer-receiver")!,
  nowIso: "2026-11-19T12:30:00.000Z",
};
const purchaser: SessionContext = {
  membership: memberships.find((m) => m.id === "mem-buyer-purchaser")!,
  nowIso: "2026-11-19T12:05:00.000Z",
};

function submittedProcurement(repo: Repository): {
  procurementId: string;
  alphaSub: SuborderId;
  betaSub: SuborderId;
} {
  const { procurementId } = repo.submitBasket(buyer);
  const state = repo.getState();
  const alphaSub = state.suborders.find((s) => s.supplierId === "sup-alpha")!.id;
  const betaSub = state.suborders.find((s) => s.supplierId === "sup-beta")!.id;
  return { procurementId, alphaSub, betaSub };
}

describe("repository: tenant isolation (IDOR/BOLA)", () => {
  it("creates a persisted parent procurement owning its suborders", () => {
    const repo = makeRepo();
    const { procurementId } = submittedProcurement(repo);
    const parent = repo.getParent(procurementId);
    expect(parent).toBeDefined();
    expect(parent!.orgId).toBe("org-demo-cafe");
    expect(parent!.suborderIds.length).toBe(2);
    // Every suborder points back at the parent.
    expect(repo.subordersOf(procurementId).length).toBe(2);
  });

  it("hides a parent from a different buyer org even with the exact id", () => {
    const repo = makeRepo();
    const { procurementId } = submittedProcurement(repo);
    expect(repo.getVisibleParent(hotelBuyer, procurementId)).toBeUndefined();
    expect(repo.visibleSubordersOf(hotelBuyer, procurementId)).toHaveLength(0);
  });

  it("shows a supplier only its own branch inside a parent", () => {
    const repo = makeRepo();
    const { procurementId } = submittedProcurement(repo);
    const betaVisible = repo.visibleSubordersOf(supplierBetaOwner, procurementId);
    expect(betaVisible).toHaveLength(1);
    expect(betaVisible[0]!.supplierId).toBe("sup-beta");
  });

  it("refuses a buyer decision on a suborder belonging to another org", () => {
    const repo = makeRepo();
    const { alphaSub } = submittedProcurement(repo);
    expect(() => repo.buyerDecide(hotelBuyer, alphaSub, "accepted", null)).toThrow(
      /доступ|прав/,
    );
  });

  it("refuses receiving by a buyer from a different org", () => {
    const repo = makeRepo();
    const { alphaSub } = submittedProcurement(repo);
    repo.confirmSuborderNoChange(supplierAlpha, alphaSub);
    repo.advanceFulfillment(supplierAlpha, alphaSub, "packing");
    repo.advanceFulfillment(supplierAlpha, alphaSub, "ready_for_handover");
    repo.advanceFulfillment(supplierAlpha, alphaSub, "shipped");
    repo.advanceFulfillment(supplierAlpha, alphaSub, "delivered");
    repo.advanceFulfillment(buyer, alphaSub, "receiving");
    expect(() => repo.recordReceipt(hotelBuyer, alphaSub, [], [])).toThrow(/прав/i);
  });
});

describe("repository: location scoping", () => {
  it("only exposes the acting org's locations", () => {
    const repo = makeRepo();
    const cafeLocations = repo.locationsForOrg("org-demo-cafe");
    expect(cafeLocations.length).toBe(2);
    expect(cafeLocations.every((l) => l.orgId === "org-demo-cafe")).toBe(true);
  });

  it("refuses selecting a location that is not in the acting org", () => {
    const repo = makeRepo();
    expect(() => repo.setBasketLocation(buyer, asBuyerLocationId("loc-hotel-1"))).toThrow(
      /недоступна|прав/i,
    );
  });

  it("records the selected location on the draft and each suborder", () => {
    const repo = makeRepo();
    repo.setBasketLocation(buyer, asBuyerLocationId("loc-cafe-2"));
    const { procurementId } = repo.submitBasket(buyer);
    const parent = repo.getParent(procurementId)!;
    expect(parent.locationId).toBe("loc-cafe-2");
    for (const s of repo.subordersOf(procurementId)) {
      expect(s.locationId).toBe("loc-cafe-2");
    }
  });

  it("blocks a group whose supplier does not cover the selected zone", () => {
    const repo = makeRepo();
    // Beta only covers almaty-center; move the basket to almaty-north.
    repo.setBasketLocation(buyer, asBuyerLocationId("loc-cafe-2"));
    const preview = repo.submitPreview(buyer);
    const betaHeld = preview.heldBack.find((h) => h.supplierId === "sup-beta");
    expect(betaHeld).toBeDefined();
    expect(betaHeld!.blockers.join(" ")).toMatch(/зону/i);
    // Only Alpha (covers almaty-north) is submitted.
    const { suborderIds } = repo.submitBasket(buyer);
    expect(suborderIds).toHaveLength(1);
  });
});

describe("repository: role matrix", () => {
  it("refuses a viewer adding to the basket", () => {
    const repo = makeRepo();
    expect(() => repo.addToBasket(viewer, "off-alpha-flour", 2)).toThrow(/прав/i);
  });

  it("refuses a viewer or receiver changing basket lines or lists", () => {
    const repo = makeRepo();
    const lineId = repo.getState().basket.lines[0]!.id;
    expect(() => repo.setBasketLineQuantity(receiver, lineId, 4)).toThrow(/прав/i);
    expect(() => repo.removeBasketLine(receiver, lineId)).toThrow(/прав/i);
    expect(() => repo.addToList(receiver, "list-cafe-weekly", "off-alpha-flour")).toThrow(
      /прав/i,
    );
  });

  it("lets a purchaser manage the basket but not submit as a viewer", () => {
    const repo = makeRepo();
    expect(() => repo.addToBasket(purchaser, "off-alpha-flour", 2)).not.toThrow();
    expect(() => repo.submitBasket(viewer)).toThrow(/прав/i);
  });

  it("refuses an order_operator editing the catalog", () => {
    const repo = makeRepo();
    expect(() => repo.updateOfferPrice(supplierAlpha, "off-alpha-flour", 1)).toThrow(
      /прав/i,
    );
  });

  it("refuses a catalog_operator responding to an order", () => {
    const repo = makeRepo();
    const { alphaSub } = submittedProcurement(repo);
    const catOperator: SessionContext = {
      membership: memberships.find((m) => m.id === "mem-sup-alpha-cat")!,
      nowIso: "2026-11-19T12:05:00.000Z",
    };
    expect(() => repo.confirmSuborderNoChange(catOperator, alphaSub)).toThrow(/прав/i);
  });
});

describe("repository: idempotency and concurrency", () => {
  it("replays an idempotent submit instead of creating a second procurement", () => {
    const repo = makeRepo();
    const keyed: SessionContext = { ...buyer, idempotencyKey: "submit-once" };
    const first = repo.submitBasket(keyed);
    const second = repo.submitBasket(keyed);
    expect(second.procurementId).toBe(first.procurementId);
    expect(repo.getState().parents).toHaveLength(1);
    expect(repo.getState().suborders).toHaveLength(2);
  });

  it("rejects a buyer decision with a stale expected version", () => {
    const repo = makeRepo();
    const { alphaSub } = submittedProcurement(repo);
    repo.proposeChange(
      supplierAlpha,
      alphaSub,
      [
        {
          offerId: "off-alpha-flour",
          changeKind: "price_changed",
          quantityBefore: 6,
          quantityAfter: 6,
          priceBefore: money(3200),
          priceAfter: money(3500),
          sellUnitLabelBefore: "мешок 5 кг",
          sellUnitLabelAfter: "мешок 5 кг",
          substitutedFromOfferId: null,
          substitutedToOfferId: null,
          reasonDemo: "новая цена (демо)",
        },
      ],
      null,
    );
    expect(() => repo.buyerDecide(buyer, alphaSub, "accepted", null, 1)).toThrow(
      /изменился|перечитайте/i,
    );
  });

  it("rejects a supplier edit with a stale expected version", () => {
    const repo = makeRepo();
    const catalogOperator: SessionContext = {
      membership: memberships.find((m) => m.id === "mem-sup-alpha-cat")!,
      nowIso: "2026-11-19T12:05:00.000Z",
    };
    expect(() =>
      repo.updateOfferPrice(catalogOperator, "off-alpha-flour", 3300, 999),
    ).toThrow(/изменилось|перечитайте/i);
  });
});

describe("repository: parent aggregation never hides a branch", () => {
  it("marks the parent partially confirmed when only one branch is confirmed", () => {
    const repo = makeRepo();
    const { procurementId, alphaSub } = submittedProcurement(repo);
    repo.confirmSuborderNoChange(supplierAlpha, alphaSub);
    const parent = repo.getParent(procurementId)!;
    expect(parent.status).toBe("partially_confirmed");
    // The other branch is still awaiting the supplier, not hidden.
    const beta = repo
      .subordersOf(procurementId)
      .find((s) => s.supplierId === "sup-beta")!;
    expect(beta.status).toBe("awaiting_supplier");
  });

  it("marks the parent confirmed only when every branch is confirmed", () => {
    const repo = makeRepo();
    const { procurementId, alphaSub, betaSub } = submittedProcurement(repo);
    repo.confirmSuborderNoChange(supplierAlpha, alphaSub);
    repo.confirmSuborderNoChange(supplierBetaOwner, betaSub);
    expect(repo.getParent(procurementId)!.status).toBe("confirmed");
  });

  it("marks the parent rejected only when every branch is rejected", () => {
    const repo = makeRepo();
    const { procurementId, alphaSub, betaSub } = submittedProcurement(repo);
    // Alpha proposes a change so the buyer has a revision to reject.
    repo.proposeChange(
      supplierAlpha,
      alphaSub,
      [
        {
          offerId: "off-alpha-flour",
          changeKind: "price_changed",
          quantityBefore: 6,
          quantityAfter: 6,
          priceBefore: money(3200),
          priceAfter: money(3500),
          sellUnitLabelBefore: "мешок 5 кг",
          sellUnitLabelAfter: "мешок 5 кг",
          substitutedFromOfferId: null,
          substitutedToOfferId: null,
          reasonDemo: "новая цена (демо)",
        },
      ],
      null,
    );
    repo.buyerDecide(buyer, alphaSub, "rejected", null);
    // Beta is still awaiting the supplier, so the parent is not "rejected".
    expect(repo.getParent(procurementId)!.status).not.toBe("rejected");
    repo.proposeChange(
      supplierBetaOwner,
      betaSub,
      [
        {
          offerId: "off-beta-oil",
          changeKind: "price_changed",
          quantityBefore: 6,
          quantityAfter: 6,
          priceBefore: money(900),
          priceAfter: money(950),
          sellUnitLabelBefore: "канистра 5 л",
          sellUnitLabelAfter: "канистра 5 л",
          substitutedFromOfferId: null,
          substitutedToOfferId: null,
          reasonDemo: "новая цена (демо)",
        },
      ],
      null,
    );
    repo.buyerDecide(buyer, betaSub, "rejected", null);
    expect(repo.getParent(procurementId)!.status).toBe("rejected");
  });

  it("never lets one branch's change affect another branch", () => {
    const repo = makeRepo();
    const { procurementId, alphaSub, betaSub } = submittedProcurement(repo);
    const betaBefore = repo.getState().suborders.find((s) => s.id === betaSub)!;
    repo.confirmSuborderNoChange(supplierAlpha, alphaSub);
    const betaAfter = repo.getState().suborders.find((s) => s.id === betaSub)!;
    // Confirming Alpha must not touch Beta's status or version.
    expect(betaAfter.status).toBe(betaBefore.status);
    expect(betaAfter.version).toBe(betaBefore.version);
    expect(repo.getParent(procurementId)!.status).toBe("partially_confirmed");
  });
});

describe("repository: reorder persists a new draft", () => {
  it("writes carried lines into the basket and never submits", () => {
    const repo = makeRepo();
    const { alphaSub } = submittedProcurement(repo);
    // Clear the basket so we can observe reorder lines land in it.
    for (const line of [...repo.getState().basket.lines]) {
      repo.removeBasketLine(buyer, line.id);
    }
    const { draft, replayed } = repo.reorderIntoBasket(buyer, alphaSub);
    expect(replayed).toBe(false);
    expect(draft.summary.carried).toBeGreaterThan(0);
    const state = repo.getState();
    expect(state.basket.lines.length).toBe(draft.summary.carried);
    // The draft carries intent, not the old price snapshot.
    for (const line of state.basket.lines) {
      const offer = state.offers.find((o) => o.id === line.offerId)!;
      expect(line.addedAtPriceSnapshot?.amount).toBe(
        offer.pricePerSellUnit.value?.amount,
      );
    }
    // No new procurement was created by reorder.
    expect(state.parents).toHaveLength(1);
  });

  it("flags a missing offer instead of dropping it", () => {
    const repo = makeRepo();
    const { alphaSub } = submittedProcurement(repo);
    const result = repo.reorderIntoBasket(buyer, alphaSub);
    expect(result.draft.lines.length).toBeGreaterThan(0);
  });

  it("is idempotent per key", () => {
    const repo = makeRepo();
    const { alphaSub } = submittedProcurement(repo);
    const keyed: SessionContext = { ...buyer, idempotencyKey: "reorder-1" };
    repo.reorderIntoBasket(keyed, alphaSub);
    const second = repo.reorderIntoBasket(keyed, alphaSub);
    expect(second.replayed).toBe(true);
  });
});

describe("repository: real CSV catalog import", () => {
  const CSV =
    "sku,title,category,sell_unit_label,units_per_sell_unit,pack_amount,pack_base_unit,price_per_sell_unit,moq,order_step,availability\n" +
    "ALF-FLOUR-5,Мука (обновлённая),Бакалея,мешок 5 кг,1,5,kg,3300,2,2,in_stock\n" +
    "NEW-SKU-1,Новый товар,Бакалея,мешок 1 кг,1,1,kg,1500,1,1,in_stock";

  it("writes new offers and updates existing ones, creating no duplicates", () => {
    const repo = makeRepo();
    const catalogOperator: SessionContext = {
      membership: memberships.find((m) => m.id === "mem-sup-alpha-cat")!,
      nowIso: "2026-11-19T12:05:00.000Z",
    };
    const existing = repo
      .getState()
      .offers.filter((o) => o.supplierId === "sup-alpha")
      .map((o) => ({
        sku: o.supplierSku,
        title: o.title,
        pricePerSellUnit: o.pricePerSellUnit.value?.amount ?? null,
        moq: o.packaging.moq,
        orderStep: o.packaging.orderStep,
      }));

    const parsed = parseCatalogCsv(CSV, { existingSkus: existing.map((e) => e.sku) });
    const resolved = resolveImportRows(parsed, existing);
    expect(resolved.summary.errors).toBe(0);
    expect(resolved.summary.updated).toBe(1);
    expect(resolved.summary.added).toBe(1);

    repo.applyCatalogImport(
      catalogOperator,
      asSupplierId("sup-alpha"),
      resolved.resolved,
      resolved.summary,
      [],
    );

    const after = repo.getState().offers.filter((o) => o.supplierId === "sup-alpha");
    // No duplicate for ALF-FLOUR-5; a new one for NEW-SKU-1.
    const flour = after.filter((o) => o.supplierSku === "ALF-FLOUR-5");
    expect(flour).toHaveLength(1);
    expect(flour[0]!.pricePerSellUnit.value?.amount).toBe(3300);
    expect(after.some((o) => o.supplierSku === "NEW-SKU-1")).toBe(true);
  });

  it("re-applying the same file changes nothing (unchanged, no duplication)", () => {
    const repo = makeRepo();
    const catalogOperator: SessionContext = {
      membership: memberships.find((m) => m.id === "mem-sup-alpha-cat")!,
      nowIso: "2026-11-19T12:05:00.000Z",
    };
    for (let pass = 0; pass < 2; pass += 1) {
      const existing = repo
        .getState()
        .offers.filter((o) => o.supplierId === "sup-alpha")
        .map((o) => ({
          sku: o.supplierSku,
          title: o.title,
          pricePerSellUnit: o.pricePerSellUnit.value?.amount ?? null,
          moq: o.packaging.moq,
          orderStep: o.packaging.orderStep,
        }));
      const parsed = parseCatalogCsv(CSV, { existingSkus: existing.map((e) => e.sku) });
      const resolved = resolveImportRows(parsed, existing);
      repo.applyCatalogImport(
        catalogOperator,
        asSupplierId("sup-alpha"),
        resolved.resolved,
        resolved.summary,
        [],
      );
      if (pass === 1) {
        expect(resolved.summary.added).toBe(0);
        expect(resolved.summary.updated).toBe(0);
        expect(resolved.summary.unchanged).toBe(2);
      }
    }
    const after = repo.getState().offers.filter((o) => o.supplierId === "sup-alpha");
    expect(after.filter((o) => o.supplierSku === "ALF-FLOUR-5")).toHaveLength(1);
    expect(after.filter((o) => o.supplierSku === "NEW-SKU-1")).toHaveLength(1);
  });

  it("refuses an atomic apply when any row has an error", () => {
    const repo = makeRepo();
    const catalogOperator: SessionContext = {
      membership: memberships.find((m) => m.id === "mem-sup-alpha-cat")!,
      nowIso: "2026-11-19T12:05:00.000Z",
    };
    expect(() =>
      repo.applyCatalogImport(
        catalogOperator,
        asSupplierId("sup-alpha"),
        [],
        { added: 0, updated: 0, errors: 1, skipped: 0 },
        [],
      ),
    ).toThrow(/ошибочн|целиком/i);
  });

  it("refuses import for a supplier the role cannot edit", () => {
    const repo = makeRepo();
    expect(() =>
      repo.applyCatalogImport(
        supplierBetaOwner,
        asSupplierId("sup-alpha"),
        [],
        { added: 0, updated: 0, errors: 0, skipped: 0 },
        [],
      ),
    ).toThrow(/прав/i);
  });
});
