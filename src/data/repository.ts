/**
 * In-browser repository for the P0 prototype.
 *
 * This is the single place that mutates prototype state. It applies domain
 * rules (authorization, lifecycle, revisions) before writing, and appends an
 * audit event for each meaningful action. It NEVER calls the network.
 *
 * In a real product, every method here would be a server-side, tenant-checked
 * operation. Here it is local-only and backed by synthetic demo data.
 */

import type {
  AuditEvent,
  Basket,
  BasketLine,
  BuyerDecision,
  BuyerList,
  BuyerLocation,
  CatalogImportJob,
  FulfillmentEvent,
  FulfillmentStatus,
  Issue,
  Membership,
  NotificationEvent,
  Organization,
  Product,
  ProcurementStatus,
  ReceiptRecord,
  SuborderRevision,
  SupplierOffer,
  SupplierProfile,
  SupplierSuborder,
} from "@/domain/entities";
import {
  asAuditEventId,
  asBasketLineId,
  asFulfillmentEventId,
  asImportJobId,
  asIssueId,
  asIso,
  asProcurementId,
  asReceiptId,
  asSuborderId,
  asDecisionId,
  asRevisionId,
  type BasketLineId,
  type SuborderId,
  type UserId,
} from "@/domain/ids";
import { money, type Money } from "@/domain/money";
import {
  canEditSupplierCatalog,
  canManageProcurement,
  canRecordReceiving,
  canRespondToSuborder,
  canViewSuborder,
} from "@/domain/authorization";
import {
  assertFulfillmentTransition,
  canStartFulfillment,
  canTransitionSuborder,
} from "@/domain/orderLifecycle";
import {
  decideOnRevision,
  proposeSupplierRevision,
  snapshotFromRevision,
  type RevisionLineInput,
} from "@/domain/revisions";
import { computeSuborderGroup } from "@/domain/cart";

export interface RepositoryState {
  organizations: Organization[];
  buyerLocations: BuyerLocation[];
  memberships: Membership[];
  suppliers: SupplierProfile[];
  products: Product[];
  offers: SupplierOffer[];
  buyerLists: BuyerList[];
  basket: Basket;
  suborders: SupplierSuborder[];
  revisions: SuborderRevision[];
  decisions: BuyerDecision[];
  fulfillments: FulfillmentEvent[];
  receipts: ReceiptRecord[];
  issues: Issue[];
  importJobs: CatalogImportJob[];
  notifications: NotificationEvent[];
  audit: AuditEvent[];
}

export interface SessionContext {
  /** The acting membership (demo persona). */
  readonly membership: Membership;
  readonly nowIso: string;
}

export function buildInitialState(seed: {
  organizations: readonly Organization[];
  buyerLocations: readonly BuyerLocation[];
  memberships: readonly Membership[];
  suppliers: readonly SupplierProfile[];
  products: readonly Product[];
  offers: readonly SupplierOffer[];
  buyerLists: readonly BuyerList[];
  basket: Basket;
  notifications: readonly NotificationEvent[];
}): RepositoryState {
  return {
    organizations: [...seed.organizations],
    buyerLocations: [...seed.buyerLocations],
    memberships: [...seed.memberships],
    suppliers: [...seed.suppliers],
    products: [...seed.products],
    offers: [...seed.offers],
    buyerLists: [...seed.buyerLists],
    basket: seed.basket,
    suborders: [],
    revisions: [],
    decisions: [],
    fulfillments: [],
    receipts: [],
    issues: [],
    importJobs: [],
    notifications: [...seed.notifications],
    audit: [],
  };
}

function cloneState(state: RepositoryState): RepositoryState {
  return structuredClone(state);
}

export class Repository {
  private state: RepositoryState;
  private readonly listeners = new Set<() => void>();
  private idCounter = 0;

  constructor(initial: RepositoryState) {
    this.state = cloneState(initial);
  }

  getState(): RepositoryState {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }

  private commit(next: RepositoryState): void {
    this.state = next;
    this.emit();
  }

  private nextId(prefix: string): string {
    this.idCounter += 1;
    return `${prefix}-${this.idCounter}`;
  }

  private audit(
    next: RepositoryState,
    ctx: SessionContext,
    action: string,
    entityType: string,
    entityId: string,
    metadata: Record<string, string | number | boolean> = {},
  ): void {
    const event: AuditEvent = {
      id: asAuditEventId(this.nextId("audit")),
      at: asIso(ctx.nowIso),
      actorUserId: ctx.membership.userId,
      actorRole: ctx.membership.role,
      action,
      entityType,
      entityId,
      metadata,
    };
    next.audit = [...next.audit, event];
  }

  /* ------------------------------ Lookups ------------------------------ */

  offersById(): ReadonlyMap<string, SupplierOffer> {
    return new Map(this.state.offers.map((o) => [o.id as string, o]));
  }

  suppliersById(): ReadonlyMap<string, SupplierProfile> {
    return new Map(this.state.suppliers.map((s) => [s.id as string, s]));
  }

  locationsById(): ReadonlyMap<string, BuyerLocation> {
    return new Map(this.state.buyerLocations.map((l) => [l.id as string, l]));
  }

  /* -------------------------- Buyer: catalog --------------------------- */

  /** Visible catalog offers: only this org's own authorized suppliers are NOT
   *  required — the catalog is shared, but archived offers are hidden. */
  visibleCatalog(): readonly SupplierOffer[] {
    return this.state.offers.filter((o) => !o.archived);
  }

  /* --------------------------- Buyer: basket --------------------------- */

  getBasketForOrg(ctx: SessionContext): Basket {
    if (ctx.membership.orgId !== this.state.basket.orgId) {
      // Return an empty basket rather than leaking another org's basket.
      return { ...this.state.basket, orgId: ctx.membership.orgId, lines: [] };
    }
    return this.state.basket;
  }

  addToBasket(ctx: SessionContext, offerId: string, quantity: number): void {
    const offer = this.state.offers.find((o) => o.id === offerId);
    if (!offer) throw new Error("Offer not found.");
    if (offer.archived) throw new Error("Cannot add an archived offer.");
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Quantity must be a positive integer.");
    }
    const next = cloneState(this.state);
    if (next.basket.orgId !== ctx.membership.orgId) {
      throw new Error("Basket belongs to a different organisation.");
    }
    const existing = next.basket.lines.find((l) => l.offerId === offerId);
    if (existing) {
      next.basket = {
        ...next.basket,
        lines: next.basket.lines.map((l) =>
          l.offerId === offerId ? { ...l, quantity: l.quantity + quantity } : l,
        ),
      };
    } else {
      const line: BasketLine = {
        id: asBasketLineId(this.nextId("bl")),
        offerId: offer.id,
        supplierId: offer.supplierId,
        quantity,
        addedAtPriceSnapshot: offer.pricePerSellUnit.value,
        addedAt: asIso(ctx.nowIso),
      };
      next.basket = { ...next.basket, lines: [...next.basket.lines, line] };
    }
    this.audit(next, ctx, "basket.add", "SupplierOffer", offerId, { quantity });
    this.commit(next);
  }

  setBasketLineQuantity(
    ctx: SessionContext,
    lineId: BasketLineId,
    quantity: number,
  ): void {
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw new Error("Quantity must be a positive integer.");
    }
    const next = cloneState(this.state);
    next.basket = {
      ...next.basket,
      lines: next.basket.lines.map((l) => (l.id === lineId ? { ...l, quantity } : l)),
    };
    this.audit(next, ctx, "basket.setQuantity", "BasketLine", lineId, { quantity });
    this.commit(next);
  }

  removeBasketLine(ctx: SessionContext, lineId: BasketLineId): void {
    const next = cloneState(this.state);
    next.basket = {
      ...next.basket,
      lines: next.basket.lines.filter((l) => l.id !== lineId),
    };
    this.audit(next, ctx, "basket.remove", "BasketLine", lineId);
    this.commit(next);
  }

  /* ------------------- Buyer: submit -> suborders ---------------------- */

  /**
   * Submit the basket's READY supplier groups.
   *
   * Each supplier is independent: groups that are valid and meet the supplier
   * minimum are converted into separate suborders; groups that are not ready
   * stay in the basket so the buyer can fix them. Returns the new procurement id
   * (when at least one group was submitted) and the ids of submitted suborders.
   */
  submitBasket(ctx: SessionContext): { procurementId: string; suborderIds: string[] } {
    if (!canManageProcurement(ctx.membership, this.state.basket.orgId)) {
      throw new Error("Not permitted to submit this basket.");
    }
    if (this.state.basket.lines.length === 0) {
      throw new Error("Basket is empty.");
    }
    const offers = this.offersById();
    const suppliers = this.suppliersById();
    const next = cloneState(this.state);
    const procurementId = this.nextId("proc");

    const bySupplier = new Map<string, BasketLine[]>();
    for (const line of this.state.basket.lines) {
      const arr = bySupplier.get(line.supplierId) ?? [];
      arr.push(line);
      bySupplier.set(line.supplierId, arr);
    }

    const suborderIds: string[] = [];
    const remainingLines: BasketLine[] = [];

    for (const [supplierId, lines] of bySupplier) {
      const supplier = suppliers.get(supplierId);
      if (!supplier) continue;

      // Only submit a group when every line is valid and the minimum is met.
      const group = computeSuborderGroup(
        supplier,
        lines
          .map((line) => {
            const offer = offers.get(line.offerId);
            return offer ? { line, offer } : null;
          })
          .filter((x): x is { line: BasketLine; offer: SupplierOffer } => x !== null),
      );

      if (!group.readyToSubmit) {
        remainingLines.push(...lines);
        continue;
      }

      const suborderId = asSuborderId(this.nextId("sub"));
      const revisionId = asRevisionId(this.nextId("rev"));
      const now = asIso(ctx.nowIso);

      const revision: SuborderRevision = {
        id: revisionId,
        suborderId,
        revisionNumber: 1,
        author: { kind: "buyer", userId: ctx.membership.userId },
        createdAt: now,
        deliveryWindowDemo: supplier.deliveryWindowsDemo[0] ?? null,
        lines: lines.map((l, i) => {
          const offer = offers.get(l.offerId);
          return {
            id: `revline-${suborderId}-${i}` as SuborderRevision["lines"][number]["id"],
            offerId: l.offerId,
            changeKind: "unchanged" as const,
            quantityBefore: l.quantity,
            quantityAfter: l.quantity,
            priceBefore: offer?.pricePerSellUnit.value ?? null,
            priceAfter: offer?.pricePerSellUnit.value ?? null,
            sellUnitLabelBefore: offer?.packaging.sellUnit.label ?? null,
            sellUnitLabelAfter: offer?.packaging.sellUnit.label ?? null,
            substitutedFromOfferId: null,
            substitutedToOfferId: null,
            reasonDemo: "Первоначальный запрос покупателя (демо)",
          };
        }),
      };

      const suborder: SupplierSuborder = {
        id: suborderId,
        procurementId: asProcurementId(procurementId),
        supplierId: supplier.id,
        orgId: this.state.basket.orgId,
        locationId: this.state.basket.locationId,
        status: "awaiting_supplier",
        fulfillmentStatus: "not_started",
        paymentStatus: "not_processed",
        confirmedLines: null,
        currentRevisionId: revisionId,
        createdAt: now,
        updatedAt: now,
        version: 1,
      };

      next.suborders = [...next.suborders, suborder];
      next.revisions = [...next.revisions, revision];
      suborderIds.push(suborderId);
    }

    if (suborderIds.length === 0) {
      throw new Error("Нет ни одной готовой к отправке группы поставщика.");
    }

    next.basket = { ...next.basket, lines: remainingLines };
    this.audit(next, ctx, "procurement.submit", "ParentProcurement", procurementId, {
      suborders: suborderIds.length,
      heldBack: remainingLines.length,
    });
    this.commit(next);
    return { procurementId, suborderIds };
  }

  /** Buyer confirms a specific suborder revision (accept). */
  buyerDecide(
    ctx: SessionContext,
    suborderId: SuborderId,
    outcome: "accepted" | "rejected",
    noteDemo: string | null,
  ): void {
    const suborder = this.state.suborders.find((s) => s.id === suborderId);
    if (!suborder) throw new Error("Suborder not found.");
    if (
      !canViewSuborder(
        ctx.membership,
        suborder,
        this.locationsById().get(suborder.locationId),
      )
    ) {
      throw new Error("Not permitted to view this suborder.");
    }
    if (!canManageProcurement(ctx.membership, suborder.orgId)) {
      throw new Error("Not permitted to decide on this suborder.");
    }
    const revision = this.state.revisions.find(
      (r) => r.id === suborder.currentRevisionId,
    );
    if (!revision) throw new Error("Current revision not found.");
    const existing = this.state.decisions.filter((d) => d.suborderId === suborderId);

    const { suborder: updated, decision } = decideOnRevision({
      suborder,
      revision,
      outcome,
      decidedBy: ctx.membership.userId,
      nowIso: ctx.nowIso,
      noteDemo,
      existingDecisions: existing,
      newId: () => asDecisionId(this.nextId("decision")),
    });

    const next = cloneState(this.state);
    next.suborders = next.suborders.map((s) => (s.id === suborderId ? updated : s));
    next.decisions = [...next.decisions, decision];
    this.audit(next, ctx, `suborder.${outcome}`, "SupplierSuborder", suborderId, {
      revisionId: revision.id,
    });
    this.commit(next);
  }

  /* -------------------- Supplier: catalog editing ---------------------- */

  updateOfferPrice(ctx: SessionContext, offerId: string, newAmount: number): void {
    const offer = this.state.offers.find((o) => o.id === offerId);
    if (!offer) throw new Error("Offer not found.");
    if (!canEditSupplierCatalog(ctx.membership, offer.supplierId)) {
      throw new Error("Not permitted to edit this offer.");
    }
    const next = cloneState(this.state);
    next.offers = next.offers.map((o) =>
      o.id === offerId
        ? {
            ...o,
            pricePerSellUnit: { value: money(newAmount), observedAt: ctx.nowIso },
            version: o.version + 1,
          }
        : o,
    );
    this.audit(next, ctx, "offer.price.update", "SupplierOffer", offerId, { newAmount });
    this.commit(next);
  }

  updateOfferAvailability(
    ctx: SessionContext,
    offerId: string,
    status: SupplierOffer["availability"]["value"],
  ): void {
    const offer = this.state.offers.find((o) => o.id === offerId);
    if (!offer) throw new Error("Offer not found.");
    if (!canEditSupplierCatalog(ctx.membership, offer.supplierId)) {
      throw new Error("Not permitted to edit this offer.");
    }
    const next = cloneState(this.state);
    next.offers = next.offers.map((o) =>
      o.id === offerId
        ? {
            ...o,
            availability: { value: status, observedAt: ctx.nowIso },
            version: o.version + 1,
          }
        : o,
    );
    this.audit(next, ctx, "offer.availability.update", "SupplierOffer", offerId, {
      status: status === null ? "unknown" : status,
    });
    this.commit(next);
  }

  /* ------------------- Supplier: respond to suborders ------------------ */

  proposeChange(
    ctx: SessionContext,
    suborderId: SuborderId,
    lines: readonly RevisionLineInput[],
    deliveryWindowDemo: string | null,
  ): void {
    const suborder = this.state.suborders.find((s) => s.id === suborderId);
    if (!suborder) throw new Error("Suborder not found.");
    if (!canRespondToSuborder(ctx.membership, suborder.supplierId)) {
      throw new Error("Not permitted to respond to this suborder.");
    }
    const nextNumber =
      this.state.revisions.filter((r) => r.suborderId === suborderId).length + 1;
    const { suborder: updated, revision } = proposeSupplierRevision({
      suborder,
      supplierId: suborder.supplierId,
      lines,
      deliveryWindowDemo,
      nowIso: ctx.nowIso,
      nextRevisionNumber: nextNumber,
      newRevisionId: () => asRevisionId(this.nextId("rev")),
    });
    const next = cloneState(this.state);
    next.suborders = next.suborders.map((s) => (s.id === suborderId ? updated : s));
    next.revisions = [...next.revisions, revision];
    this.audit(next, ctx, "suborder.propose_change", "SupplierSuborder", suborderId, {
      revisionNumber: nextNumber,
    });
    this.commit(next);
  }

  confirmSuborderNoChange(ctx: SessionContext, suborderId: SuborderId): void {
    const suborder = this.state.suborders.find((s) => s.id === suborderId);
    if (!suborder) throw new Error("Suborder not found.");
    if (!canRespondToSuborder(ctx.membership, suborder.supplierId)) {
      throw new Error("Not permitted to respond to this suborder.");
    }
    if (!canTransitionSuborder(suborder.status, "confirmed")) {
      throw new Error(`Cannot confirm from status ${suborder.status}.`);
    }
    const revision = this.state.revisions.find(
      (r) => r.id === suborder.currentRevisionId,
    );
    const next = cloneState(this.state);
    const now = asIso(ctx.nowIso);
    next.suborders = next.suborders.map((s) =>
      s.id === suborderId
        ? {
            ...s,
            status: "confirmed" as const,
            confirmedLines:
              s.confirmedLines ?? (revision ? snapshotFromRevision(revision) : []),
            updatedAt: now,
            version: s.version + 1,
          }
        : s,
    );
    this.audit(next, ctx, "suborder.confirm_no_change", "SupplierSuborder", suborderId);
    this.commit(next);
  }

  /* ---------------------- Fulfillment / receiving ---------------------- */

  advanceFulfillment(
    ctx: SessionContext,
    suborderId: SuborderId,
    to: FulfillmentStatus,
  ): void {
    const suborder = this.state.suborders.find((s) => s.id === suborderId);
    if (!suborder) throw new Error("Suborder not found.");
    if (to === "receiving" || to === "completed") {
      if (!canRecordReceiving(ctx.membership, suborder.orgId)) {
        throw new Error("Not permitted to record receiving.");
      }
    } else {
      if (!canRespondToSuborder(ctx.membership, suborder.supplierId)) {
        throw new Error("Not permitted to advance fulfillment.");
      }
    }
    if (
      !canStartFulfillment(suborder.status) &&
      suborder.fulfillmentStatus === "not_started"
    ) {
      throw new Error("Cannot start fulfillment before the order is confirmed.");
    }
    assertFulfillmentTransition(suborder.fulfillmentStatus, to);

    const next = cloneState(this.state);
    const now = asIso(ctx.nowIso);
    next.suborders = next.suborders.map((s) =>
      s.id === suborderId
        ? { ...s, fulfillmentStatus: to, updatedAt: now, version: s.version + 1 }
        : s,
    );
    const idempotencyKey = `${suborderId}:${suborder.fulfillmentStatus}->${to}`;
    if (!next.fulfillments.some((f) => f.idempotencyKey === idempotencyKey)) {
      next.fulfillments = [
        ...next.fulfillments,
        {
          id: asFulfillmentEventId(this.nextId("ff")),
          suborderId,
          type: "status_changed",
          fromStatus: suborder.fulfillmentStatus,
          toStatus: to,
          at: now,
          idempotencyKey,
        },
      ];
    }
    this.audit(next, ctx, "fulfillment.advance", "SupplierSuborder", suborderId, { to });
    this.commit(next);
  }

  recordReceipt(
    ctx: SessionContext,
    suborderId: SuborderId,
    lines: ReceiptRecord["lines"],
    discrepancies: ReceiptRecord["notedDiscrepancies"],
  ): void {
    const suborder = this.state.suborders.find((s) => s.id === suborderId);
    if (!suborder) throw new Error("Suborder not found.");
    if (!canRecordReceiving(ctx.membership, suborder.orgId)) {
      throw new Error("Not permitted to record receiving.");
    }
    const next = cloneState(this.state);
    const now = asIso(ctx.nowIso);
    next.receipts = [
      ...next.receipts,
      {
        id: asReceiptId(this.nextId("receipt")),
        suborderId,
        recordedBy: ctx.membership.userId,
        recordedAt: now,
        lines,
        notedDiscrepancies: discrepancies,
      },
    ];
    for (const reason of discrepancies) {
      next.issues = [
        ...next.issues,
        {
          id: asIssueId(this.nextId("issue")),
          suborderId,
          reason,
          descriptionDemo: `Демонстрационное расхождение: ${reason}`,
          openedBy: ctx.membership.userId,
          openedAt: now,
          state: "open_demo",
        },
      ];
    }
    this.audit(next, ctx, "receipt.record", "SupplierSuborder", suborderId, {
      discrepancies: discrepancies.length,
    });
    this.commit(next);
  }

  /* --------------------------- Buyer lists ----------------------------- */

  addToList(ctx: SessionContext, listId: string, offerId: string): void {
    const list = this.state.buyerLists.find((l) => l.id === listId);
    if (!list) throw new Error("List not found.");
    if (list.orgId !== ctx.membership.orgId) throw new Error("Not permitted.");
    const next = cloneState(this.state);
    next.buyerLists = next.buyerLists.map((l) =>
      l.id === listId && !l.offerIds.includes(offerId as never)
        ? { ...l, offerIds: [...l.offerIds, offerId as never] }
        : l,
    );
    this.audit(next, ctx, "list.add", "BuyerList", listId, { offerId });
    this.commit(next);
  }

  /* --------------------------- Import jobs ----------------------------- */

  applyImportJob(
    ctx: SessionContext,
    supplierId: SupplierProfile["id"],
    job: Omit<CatalogImportJob, "id" | "supplierId" | "createdAt">,
  ): void {
    if (!canEditSupplierCatalog(ctx.membership, supplierId)) {
      throw new Error("Not permitted to import for this supplier.");
    }
    const next = cloneState(this.state);
    next.importJobs = [
      ...next.importJobs,
      {
        id: asImportJobId(this.nextId("import")),
        supplierId,
        createdAt: asIso(ctx.nowIso),
        appliedOfferIds: job.appliedOfferIds,
        rows: job.rows,
        summary: job.summary,
      },
    ];
    this.audit(next, ctx, "catalog.import.apply", "ImportJob", supplierId, {
      added: job.summary.added,
      updated: job.summary.updated,
      errors: job.summary.errors,
    });
    this.commit(next);
  }

  /* --------------------------- Notifications --------------------------- */

  markNotificationRead(ctx: SessionContext, notificationId: string): void {
    const next = cloneState(this.state);
    next.notifications = next.notifications.map((n) =>
      n.id === notificationId && n.audienceUserId === ctx.membership.userId
        ? { ...n, read: true }
        : n,
    );
    this.commit(next);
  }

  /* ------------------------------ Operator ----------------------------- */

  /** Operator can only view the synthetic demo queue. No mutations granted. */
  demoModerationQueue(): readonly SupplierProfile[] {
    return this.state.suppliers.map((s) => s);
  }

  /* --------------------------- Admin (guard) --------------------------- */

  /** Explicit deny: operators/others must not mutate order terms here. */
  static assertOperatorCannotEditTerms(): never {
    throw new Error("Operators cannot edit order terms in the prototype.");
  }
}

/** Convenience: the current session's acting user id. */
export type { UserId };
export type { ProcurementStatus, Money };
