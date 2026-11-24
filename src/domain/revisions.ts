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
import { conflictError, forbiddenError, staleDataError, validationError } from "./errors";

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
 * Input boundary for supplier proposals. A revision must never be able to
 * carry an impossible price or quantity, even when a caller bypasses the UI.
 */
function assertRevisionLineInputs(lines: readonly RevisionLineInput[]): void {
  for (const line of lines) {
    for (const q of [line.quantityBefore, line.quantityAfter]) {
      if (q !== null && (!Number.isSafeInteger(q) || q <= 0)) {
        throw validationError(
          "Количество в изменении должно быть целым положительным (демо).",
        );
      }
    }
    for (const p of [line.priceBefore, line.priceAfter]) {
      if (
        p !== null &&
        (!Number.isSafeInteger(p.amount) || p.amount < 0 || p.currency !== "KZT")
      ) {
        throw validationError(
          "Цена в изменении должна быть неотрицательной целой суммой KZT (демо).",
        );
      }
    }
  }
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
    throw conflictError("Decision revision does not belong to this suborder.");
  }
  if (suborder.currentRevisionId !== revision.id) {
    throw staleDataError("Cannot decide on a superseded revision.");
  }
  if (suborder.status !== "awaiting_buyer_decision") {
    throw conflictError(
      `Suborder is not awaiting a buyer decision (${suborder.status}).`,
    );
  }
  if (
    existingDecisions.some(
      (d) => d.suborderId === suborder.id && d.revisionId === revision.id,
    )
  ) {
    throw conflictError("A decision for this revision already exists.");
  }

  const target = outcome === "accepted" ? "confirmed" : "rejected";
  assertSuborderTransition(suborder.status, target);

  // Accepting a revision is what BINDS its AFTER values. Refuse to confirm if
  // any line cannot produce a complete snapshot (e.g. a substitution recorded
  // with no price on either side): we must never invent a binding price. An
  // honest rejection is better than a fabricated 0 ₸ confirmed line.
  if (outcome === "accepted") {
    for (const l of revision.lines) {
      const price = l.priceAfter ?? l.priceBefore;
      const quantity = l.quantityAfter ?? l.quantityBefore;
      if (price === null || quantity === null || quantity <= 0) {
        throw validationError(
          "Нельзя подтвердить изменение без известной цены и количества по позиции.",
        );
      }
    }
  }

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

/**
 * Build immutable line snapshots from an accepted revision (uses AFTER values).
 *
 * Never fabricates a value: a line with no known price or quantity is a bug and
 * throws, rather than binding a silent `0 ₸` line. `decideOnRevision` rejects
 * such a revision before confirmation, so this is a defence in depth.
 */
export function snapshotFromRevision(
  revision: SuborderRevision,
): readonly SuborderLineSnapshot[] {
  return revision.lines.map((l) => {
    const price = l.priceAfter ?? l.priceBefore;
    const quantity = l.quantityAfter ?? l.quantityBefore;
    if (price === null || quantity === null) {
      throw validationError(
        "Невозможно построить подтверждённую строку без цены и количества.",
      );
    }
    if (quantity <= 0) {
      throw validationError(
        "Невозможно подтвердить строку с неположительным количеством.",
      );
    }
    return {
      id: `snapshot-${revision.id}-${l.offerId}` as SuborderLineSnapshot["id"],
      offerId: l.offerId,
      title: l.sellUnitLabelAfter ?? l.sellUnitLabelBefore ?? "—",
      quantity,
      pricePerSellUnit: price,
      sellUnitLabel: l.sellUnitLabelAfter ?? l.sellUnitLabelBefore ?? "—",
    };
  });
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
    throw conflictError(`Cannot propose a change from status ${suborder.status}.`);
  }
  if (supplierId !== suborder.supplierId) {
    throw forbiddenError(
      "Изменение может предлагать только поставщик этой ветки (демо).",
    );
  }
  if (!Number.isSafeInteger(nextRevisionNumber) || nextRevisionNumber < 1) {
    throw validationError("Номер ревизии должен быть положительным целым числом (демо).");
  }
  assertRevisionLineInputs(lines);
  if (!hasAnyChange(lines)) {
    throw validationError("A revision must actually change something.");
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
