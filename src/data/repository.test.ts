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
import { asSuborderId } from "@/domain/ids";
import { money } from "@/domain/money";

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
    expect(() => repo.submitBasket(viewer)).toThrow(/Not permitted/);
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
    expect(() => repo.submitBasket(buyer)).toThrow(/empty/i);
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
      /Not permitted/,
    );
  });

  it("refuses a supplier response to another supplier's suborder", () => {
    const repo = makeRepo();
    submitReadyBasket(repo);
    const betaSub = repo.getState().suborders.find((s) => s.supplierId === "sup-beta")!;
    expect(() => repo.confirmSuborderNoChange(supplierAlpha, betaSub.id)).toThrow(
      /Not permitted/,
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
      /before the order is confirmed/,
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
      /Not permitted/,
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
    ).toThrow(/not found/i);
  });
});
