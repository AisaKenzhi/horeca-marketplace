/**
 * Revision & decision rules.
 *
 * A price/quantity/packaging/substitution change creates a visible NEW version
 * with a before/after and an author. It only BINDS once a buyer decision is
 * recorded for THAT EXACT revision. Silence is never consent, and a decision on
 * one revision never applies to a later one.
 */

import type {
  BuyerDecision,
  SuborderRevision,
  SuborderLineSnapshot,
  SupplierSuborder,
} from "./entities";
import { asDecisionId, asIso, asRevisionId } from "./ids";
import { canTransitionSuborder, assertSuborderTransition } from "./orderLifecycle";

export interface RevisionLineInput {
  readonly offerId: string;
  readonly changeKind: SuborderRevision["lines"][number]["changeKind"];
  readonly quantityBefore: number | null;
  readonly quantityAfter: number | null;
  readonly priceBefore: { amount: number; currency: "KZT" } | null;
  readonly priceAfter: { amount: number; currency: "KZT" } | null;
  readonly sellUnitLabelBefore: string | null;
  readonly sellUnitLabelAfter: string | null;
  readonly substitutedFromOfferId: string | null;
  readonly substitutedToOfferId: string | null;
  readonly reasonDemo: string;
}

export function hasAnyChange(lines: readonly RevisionLineInput[]): boolean {
  return lines.some((l) => l.changeKind !== "unchanged");
}

/**
 * Record a buyer decision for a specific revision. Rejects:
 *   - a decision for a revision that is not the suborder's current revision
 *   - a decision on a suborder that is not awaiting a buyer decision
 *   - a duplicate decision for the same revision
 */
export function decideOnRevision(args: {
  suborder: SupplierSuborder;
  revision: SuborderRevision;
  outcome: BuyerDecision["outcome"];
  decidedBy: BuyerDecision["decidedBy"];
  nowIso: string;
  noteDemo?: string | null;
  existingDecisions: readonly BuyerDecision[];
  newId?: () => string;
}): { suborder: SupplierSuborder; decision: BuyerDecision } {
  const { suborder, revision, outcome, decidedBy, nowIso, existingDecisions } = args;
  if (revision.suborderId !== suborder.id) {
    throw new Error("Decision revision does not belong to this suborder.");
  }
  if (suborder.currentRevisionId !== revision.id) {
    throw new Error("Cannot decide on a superseded revision.");
  }
  if (suborder.status !== "awaiting_buyer_decision") {
    throw new Error(`Suborder is not awaiting a buyer decision (${suborder.status}).`);
  }
  if (existingDecisions.some((d) => d.revisionId === revision.id)) {
    throw new Error("A decision for this revision already exists.");
  }

  const target = outcome === "accepted" ? "confirmed" : "rejected";
  assertSuborderTransition(suborder.status, target);

  const decision: BuyerDecision = {
    id: asDecisionId(args.newId?.() ?? `decision-${revision.id}-${outcome}`),
    suborderId: suborder.id,
    revisionId: revision.id,
    outcome,
    decidedBy,
    decidedAt: asIso(nowIso),
    noteDemo: args.noteDemo ?? null,
  };

  const confirmedLines: readonly SuborderLineSnapshot[] | null =
    outcome === "accepted" ? snapshotFromRevision(revision) : null;

  return {
    decision,
    suborder: {
      ...suborder,
      status: target,
      confirmedLines,
      updatedAt: asIso(nowIso),
      version: suborder.version + 1,
    },
  };
}

/** Build immutable line snapshots from an accepted revision (uses AFTER values). */
export function snapshotFromRevision(
  revision: SuborderRevision,
): readonly SuborderLineSnapshot[] {
  return revision.lines.map((l) => ({
    id: `snapshot-${revision.id}-${l.offerId}` as SuborderLineSnapshot["id"],
    offerId: l.offerId,
    title: l.sellUnitLabelAfter ?? l.sellUnitLabelBefore ?? "—",
    quantity: l.quantityAfter ?? l.quantityBefore ?? 0,
    pricePerSellUnit: l.priceAfter ?? l.priceBefore ?? { amount: 0, currency: "KZT" },
    sellUnitLabel: l.sellUnitLabelAfter ?? l.sellUnitLabelBefore ?? "—",
  }));
}

/**
 * Propose a change from the supplier. This ALWAYS moves the suborder to
 * `change_proposed` and then `awaiting_buyer_decision`; it never auto-confirms.
 */
export function proposeSupplierRevision(args: {
  suborder: SupplierSuborder;
  lines: readonly RevisionLineInput[];
  deliveryWindowDemo: string | null;
  supplierId: SupplierSuborder["supplierId"];
  nowIso: string;
  nextRevisionNumber: number;
  newRevisionId?: () => string;
}): { suborder: SupplierSuborder; revision: SuborderRevision } {
  const { suborder, lines, nowIso, supplierId, nextRevisionNumber } = args;
  if (!canTransitionSuborder(suborder.status, "change_proposed")) {
    throw new Error(`Cannot propose a change from status ${suborder.status}.`);
  }
  if (!hasAnyChange(lines)) {
    throw new Error("A revision must actually change something.");
  }

  const revision: SuborderRevision = {
    id: asRevisionId(
      args.newRevisionId?.() ?? `revision-${suborder.id}-${nextRevisionNumber}`,
    ),
    suborderId: suborder.id,
    revisionNumber: nextRevisionNumber,
    author: { kind: "supplier", supplierId },
    createdAt: asIso(nowIso),
    deliveryWindowDemo: args.deliveryWindowDemo,
    lines: lines.map((l, i) => ({
      id: `revline-${l.offerId}-${i}` as SuborderRevision["lines"][number]["id"],
      offerId: l.offerId as SuborderRevision["lines"][number]["offerId"],
      changeKind: l.changeKind,
      quantityBefore: l.quantityBefore,
      quantityAfter: l.quantityAfter,
      priceBefore: l.priceBefore,
      priceAfter: l.priceAfter,
      sellUnitLabelBefore: l.sellUnitLabelBefore,
      sellUnitLabelAfter: l.sellUnitLabelAfter,
      substitutedFromOfferId:
        l.substitutedFromOfferId as SuborderRevision["lines"][number]["substitutedFromOfferId"],
      substitutedToOfferId:
        l.substitutedToOfferId as SuborderRevision["lines"][number]["substitutedToOfferId"],
      reasonDemo: l.reasonDemo,
    })),
  };

  // change_proposed -> awaiting_buyer_decision is applied immediately so the
  // buyer sees an actionable state; the intermediate is still type-valid.
  assertSuborderTransition(suborder.status, "change_proposed");
  assertSuborderTransition("change_proposed", "awaiting_buyer_decision");

  return {
    revision,
    suborder: {
      ...suborder,
      status: "awaiting_buyer_decision",
      currentRevisionId: revision.id,
      updatedAt: asIso(nowIso),
      version: suborder.version + 1,
    },
  };
}

/** Describe a revision line change for "was / became" display. */
export function describeRevisionLine(line: SuborderRevision["lines"][number]): string {
  switch (line.changeKind) {
    case "unchanged":
      return "Без изменений";
    case "price_changed":
      return `Цена: ${line.priceBefore?.amount ?? "—"} → ${line.priceAfter?.amount ?? "—"}`;
    case "quantity_changed":
      return `Количество: ${line.quantityBefore ?? "—"} → ${line.quantityAfter ?? "—"}`;
    case "packaging_changed":
      return `Фасовка: ${line.sellUnitLabelBefore ?? "—"} → ${line.sellUnitLabelAfter ?? "—"}`;
    case "substituted":
      return "Предложена замена позиции";
    case "delivery_window_changed":
      return "Изменено окно доставки";
  }
}
