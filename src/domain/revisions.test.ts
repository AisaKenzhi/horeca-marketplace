import { describe, expect, it } from "vitest";
import {
  decideOnRevision,
  hasAnyChange,
  proposeSupplierRevision,
  type RevisionLineInput,
} from "@/domain/revisions";
import { asRevisionId } from "@/domain/ids";
import { money } from "@/domain/money";
import { makeSuborder, NOW } from "../../tests/fixtures";
import type { SuborderRevision } from "@/domain/entities";

function revisionFor(suborderId: string, id: string): SuborderRevision {
  return {
    id: asRevisionId(id),
    suborderId:
      makeSuborder().id === suborderId ? makeSuborder().id : (suborderId as never),
    revisionNumber: 1,
    author: { kind: "supplier", supplierId: makeSuborder().supplierId },
    createdAt: NOW,
    deliveryWindowDemo: null,
    lines: [
      {
        id: "revline-1" as SuborderRevision["lines"][number]["id"],
        offerId:
          makeSuborder().confirmedLines?.[0]?.offerId ?? ("offer-alpha-flour" as never),
        changeKind: "price_changed",
        quantityBefore: 2,
        quantityAfter: 2,
        priceBefore: money(3200),
        priceAfter: money(3500),
        sellUnitLabelBefore: "мешок 5 кг",
        sellUnitLabelAfter: "мешок 5 кг",
        substitutedFromOfferId: null,
        substitutedToOfferId: null,
        reasonDemo: "Изменение закупочной цены (демо)",
      },
    ],
  };
}

describe("revisions", () => {
  it("detects whether a revision actually changes anything", () => {
    const unchanged: RevisionLineInput[] = [
      {
        offerId: "o1",
        changeKind: "unchanged",
        quantityBefore: 2,
        quantityAfter: 2,
        priceBefore: money(100),
        priceAfter: money(100),
        sellUnitLabelBefore: "x",
        sellUnitLabelAfter: "x",
        substitutedFromOfferId: null,
        substitutedToOfferId: null,
        reasonDemo: "-",
      },
    ];
    expect(hasAnyChange(unchanged)).toBe(false);
    expect(
      hasAnyChange([
        { ...unchanged[0]!, changeKind: "price_changed", priceAfter: money(200) },
      ]),
    ).toBe(true);
  });

  it("moves an awaiting-supplier suborder to awaiting-buyer-decision on a proposal", () => {
    const sub = makeSuborder({ status: "awaiting_supplier" });
    const { suborder, revision } = proposeSupplierRevision({
      suborder: sub,
      supplierId: sub.supplierId,
      lines: [
        {
          offerId: "offer-alpha-flour",
          changeKind: "price_changed",
          quantityBefore: 2,
          quantityAfter: 2,
          priceBefore: money(3200),
          priceAfter: money(3500),
          sellUnitLabelBefore: "мешок 5 кг",
          sellUnitLabelAfter: "мешок 5 кг",
          substitutedFromOfferId: null,
          substitutedToOfferId: null,
          reasonDemo: "Цена изменилась (демо)",
        },
      ],
      deliveryWindowDemo: null,
      nowIso: NOW,
      nextRevisionNumber: 1,
    });
    expect(suborder.status).toBe("awaiting_buyer_decision");
    expect(suborder.currentRevisionId).toBe(revision.id);
    expect(suborder.version).toBe(sub.version + 1);
  });

  it("refuses to propose a no-op revision", () => {
    const sub = makeSuborder({ status: "awaiting_supplier" });
    expect(() =>
      proposeSupplierRevision({
        suborder: sub,
        supplierId: sub.supplierId,
        lines: [
          {
            offerId: "o1",
            changeKind: "unchanged",
            quantityBefore: 1,
            quantityAfter: 1,
            priceBefore: money(1),
            priceAfter: money(1),
            sellUnitLabelBefore: "a",
            sellUnitLabelAfter: "a",
            substitutedFromOfferId: null,
            substitutedToOfferId: null,
            reasonDemo: "-",
          },
        ],
        deliveryWindowDemo: null,
        nowIso: NOW,
        nextRevisionNumber: 2,
      }),
    ).toThrow(/must actually change/);
  });

  it("binds only after an explicit buyer acceptance of THAT revision", () => {
    const sub = makeSuborder({
      status: "awaiting_buyer_decision",
      currentRevisionId: asRevisionId("rev-1"),
    });
    const revision = { ...revisionFor(sub.id, "rev-1"), suborderId: sub.id };
    const { suborder, decision } = decideOnRevision({
      suborder: sub,
      revision,
      outcome: "accepted",
      decidedBy: sub.orgId as never,
      nowIso: NOW,
      existingDecisions: [],
    });
    expect(suborder.status).toBe("confirmed");
    expect(suborder.confirmedLines).not.toBeNull();
    expect(decision.outcome).toBe("accepted");
    expect(decision.revisionId).toBe(revision.id);
  });

  it("rejects and records a decision without binding lines", () => {
    const sub = makeSuborder({
      status: "awaiting_buyer_decision",
      currentRevisionId: asRevisionId("rev-1"),
    });
    const revision = { ...revisionFor(sub.id, "rev-1"), suborderId: sub.id };
    const { suborder } = decideOnRevision({
      suborder: sub,
      revision,
      outcome: "rejected",
      decidedBy: sub.orgId as never,
      nowIso: NOW,
      existingDecisions: [],
    });
    expect(suborder.status).toBe("rejected");
    expect(suborder.confirmedLines).toBeNull();
  });

  it("refuses to decide on a superseded revision", () => {
    const sub = makeSuborder({
      status: "awaiting_buyer_decision",
      currentRevisionId: asRevisionId("rev-2"),
    });
    const old = { ...revisionFor(sub.id, "rev-1"), suborderId: sub.id };
    expect(() =>
      decideOnRevision({
        suborder: sub,
        revision: old,
        outcome: "accepted",
        decidedBy: sub.orgId as never,
        nowIso: NOW,
        existingDecisions: [],
      }),
    ).toThrow(/superseded/);
  });

  it("refuses a second decision for the same revision", () => {
    const sub = makeSuborder({
      status: "awaiting_buyer_decision",
      currentRevisionId: asRevisionId("rev-1"),
    });
    const revision = { ...revisionFor(sub.id, "rev-1"), suborderId: sub.id };
    expect(() =>
      decideOnRevision({
        suborder: sub,
        revision,
        outcome: "accepted",
        decidedBy: sub.orgId as never,
        nowIso: NOW,
        existingDecisions: [
          {
            id: "d1" as never,
            suborderId: sub.id,
            revisionId: revision.id,
            outcome: "accepted",
            decidedBy: sub.orgId as never,
            decidedAt: NOW,
            noteDemo: null,
          },
        ],
      }),
    ).toThrow(/already exists/);
  });

  it("refuses a decision when the suborder is not awaiting one (silence is not consent)", () => {
    const sub = makeSuborder({
      status: "awaiting_supplier",
      currentRevisionId: asRevisionId("rev-1"),
    });
    const revision = { ...revisionFor(sub.id, "rev-1"), suborderId: sub.id };
    expect(() =>
      decideOnRevision({
        suborder: sub,
        revision,
        outcome: "accepted",
        decidedBy: sub.orgId as never,
        nowIso: NOW,
        existingDecisions: [],
      }),
    ).toThrow(/not awaiting/);
  });
});
