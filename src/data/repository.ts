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
  ParentProcurement,
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
  asOfferId,
  asProcurementId,
  asProductId,
  asReceiptId,
  asSuborderId,
  asDecisionId,
  asRevisionId,
  type BasketLineId,
  type OfferId,
  type SuborderId,
  type UserId,
} from "@/domain/ids";
import { money, type Money } from "@/domain/money";
import {
  canAccessLocation,
  canEditSupplierCatalog,
  canManageBasket,
  canManageProcurement,
  canRecordReceiving,
  canRespondToSuborder,
  canViewParentProcurement,
  canViewSuborder,
  isSupplierSide,
  visibleSubordersForBuyer,
  visibleSubordersForSupplier,
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
import { buildReorderDraft } from "@/domain/reorder";
import type { ReorderDraft } from "@/domain/reorder";
import type { BaseUnit } from "@/domain/packaging";
import type { AvailabilityStatus } from "@/domain/freshness";
import {
  conflictError,
  forbiddenError,
  notFoundError,
  validationError,
} from "@/domain/errors";

/**
 * A fully validated, resolved import row ready to be written. Produced by
 * `resolveImportRows` in the domain from a `ParsedImport`. Only rows with no
 * errors appear here.
 */
export interface ResolvedImportOffer {
  readonly sku: string;
  readonly title: string;
  readonly category: string;
  readonly sellUnitLabel: string;
  readonly unitsPerSellUnit: number;
  readonly packAmount: number;
  readonly packBaseUnit: BaseUnit;
  readonly pricePerSellUnit: number;
  readonly moq: number;
  readonly orderStep: number;
  readonly availability: AvailabilityStatus | null;
}

export interface ReorderResult {
  readonly draft: ReorderDraft;
  readonly replayed: boolean;
}

export interface RepositoryState {
  organizations: Organization[];
  buyerLocations: BuyerLocation[];
  memberships: Membership[];
  suppliers: SupplierProfile[];
  products: Product[];
  offers: SupplierOffer[];
  buyerLists: BuyerList[];
  basket: Basket;
  parents: ParentProcurement[];
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
  /**
   * Optional idempotency key for a side-effecting operation. Two calls with the
   * same key must produce one effect. Used to make double-click and retry safe.
   */
  readonly idempotencyKey?: string;
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
    parents: [],
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

  locationsForOrg(orgId: string): readonly BuyerLocation[] {
    return this.state.buyerLocations.filter((l) => l.orgId === orgId);
  }

  getParent(procurementId: string): ParentProcurement | undefined {
    return this.state.parents.find((p) => p.id === procurementId);
  }

  /**
   * Tenant-checked parent read. Returns the parent only when the acting member
   * may see it (buyer org owns it, or a supplier has a branch inside it).
   * Unknown / foreign ids return undefined — never a foreign object.
   */
  getVisibleParent(
    ctx: SessionContext,
    procurementId: string,
  ): ParentProcurement | undefined {
    const parent = this.state.parents.find((p) => p.id === procurementId);
    if (!parent) return undefined;
    const children = this.subordersOf(procurementId);
    if (
      canViewParentProcurement(ctx.membership, parent, children, this.locationsById())
    ) {
      return parent;
    }
    return undefined;
  }

  subordersOf(procurementId: string): readonly SupplierSuborder[] {
    return this.state.suborders.filter((s) => s.procurementId === procurementId);
  }

  /**
   * Tenant-checked list of the suborders the acting member may see inside a
   * parent. A foreign supplier sees only its own branch; a foreign buyer org
   * sees an empty list.
   */
  visibleSubordersOf(
    ctx: SessionContext,
    procurementId: string,
  ): readonly SupplierSuborder[] {
    const children = this.subordersOf(procurementId);
    if (isSupplierSide(ctx.membership)) {
      return visibleSubordersForSupplier(ctx.membership, children);
    }
    return visibleSubordersForBuyer(ctx.membership, children, this.locationsById());
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
    // Only expose the basket if the acting member may access its location.
    const loc = this.locationsById().get(this.state.basket.locationId);
    if (!canAccessLocation(ctx.membership, loc)) {
      return { ...this.state.basket, lines: [] };
    }
    return this.state.basket;
  }

  /** The buyer's current deliver-to location for the basket, tenant-checked. */
  getBasketLocation(ctx: SessionContext): BuyerLocation | undefined {
    if (ctx.membership.orgId !== this.state.basket.orgId) return undefined;
    const loc = this.locationsById().get(this.state.basket.locationId);
    return canAccessLocation(ctx.membership, loc) ? loc : undefined;
  }

  /**
   * Select which of the org's locations the basket delivers to. The location
   * must belong to the acting buyer org; it is never inferred from "the first".
   */
  setBasketLocation(ctx: SessionContext, locationId: string): void {
    if (!canManageBasket(ctx.membership, this.state.basket.orgId)) {
      throw forbiddenError("Недостаточно прав для изменения точки доставки.");
    }
    const loc = this.state.buyerLocations.find((l) => l.id === locationId);
    if (!loc) throw notFoundError("Точка доставки не найдена.");
    if (!canAccessLocation(ctx.membership, loc)) {
      throw forbiddenError("Эта точка доставки недоступна вашей организации.");
    }
    const next = cloneState(this.state);
    next.basket = { ...next.basket, locationId: loc.id };
    this.audit(next, ctx, "basket.setLocation", "BuyerLocation", locationId);
    this.commit(next);
  }

  addToBasket(ctx: SessionContext, offerId: string, quantity: number): void {
    if (!canManageBasket(ctx.membership, this.state.basket.orgId)) {
      throw forbiddenError("Недостаточно прав для изменения корзины.");
    }
    const offer = this.state.offers.find((o) => o.id === offerId);
    if (!offer) throw notFoundError("Предложение не найдено.");
    if (offer.archived)
      throw conflictError("Нельзя добавить снятое с продажи предложение.");
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw validationError("Количество должно быть целым положительным числом.");
    }
    const next = cloneState(this.state);
    if (next.basket.orgId !== ctx.membership.orgId) {
      throw forbiddenError("Корзина принадлежит другой организации.");
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
    if (!canManageBasket(ctx.membership, this.state.basket.orgId)) {
      throw forbiddenError("Недостаточно прав для изменения корзины.");
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw validationError("Количество должно быть целым положительным числом.");
    }
    if (!this.state.basket.lines.some((l) => l.id === lineId)) {
      throw notFoundError("Строка корзины не найдена.");
    }
    const next = cloneState(this.state);
    next.basket = {
      ...next.basket,
      lines: next.basket.lines.map((l) =>
        l.id === lineId
          ? // Refresh the snapshot so a deliberate quantity change re-baselines
            // the price the buyer is looking at.
            { ...l, quantity, addedAtPriceSnapshot: this.livePriceFor(l.offerId) }
          : l,
      ),
    };
    this.audit(next, ctx, "basket.setQuantity", "BasketLine", lineId, { quantity });
    this.commit(next);
  }

  removeBasketLine(ctx: SessionContext, lineId: BasketLineId): void {
    if (!canManageBasket(ctx.membership, this.state.basket.orgId)) {
      throw forbiddenError("Недостаточно прав для изменения корзины.");
    }
    if (!this.state.basket.lines.some((l) => l.id === lineId)) {
      throw notFoundError("Строка корзины не найдена.");
    }
    const next = cloneState(this.state);
    next.basket = {
      ...next.basket,
      lines: next.basket.lines.filter((l) => l.id !== lineId),
    };
    this.audit(next, ctx, "basket.remove", "BasketLine", lineId);
    this.commit(next);
  }

  private livePriceFor(offerId: string): Money | null {
    return (
      this.state.offers.find((o) => o.id === offerId)?.pricePerSellUnit.value ?? null
    );
  }

  /* ------------------- Buyer: submit -> suborders ---------------------- */

  /**
   * Submit the basket's READY supplier groups.
   *
   * Each supplier is independent: groups that are valid, meet the supplier
   * minimum, and are covered by the selected location are converted into
   * separate suborders; groups that are not ready stay in the basket so the
   * buyer can fix them. A persisted ParentProcurement is created atomically
   * together with the suborders.
   *
   * Idempotency: when `ctx.idempotencyKey` is provided and has already produced
   * a procurement, the previous result is returned without creating a second
   * one (safe for double-click / retry after an unclear timeout).
   */
  submitBasket(ctx: SessionContext): { procurementId: string; suborderIds: string[] } {
    if (!canManageProcurement(ctx.membership, this.state.basket.orgId)) {
      throw forbiddenError("Недостаточно прав для отправки этой корзины.");
    }
    // Idempotent replay: return the prior result for the same key BEFORE any
    // other validation, so a retry after an unclear outcome never fails with a
    // spurious "empty basket" or creates a second procurement.
    if (ctx.idempotencyKey) {
      const prior = this.state.audit.find(
        (a) =>
          a.action === "procurement.submit" &&
          a.actorUserId === ctx.membership.userId &&
          a.metadata.idempotencyKey === ctx.idempotencyKey,
      );
      if (prior) {
        const existingParent = this.state.parents.find((p) => p.id === prior.entityId);
        if (existingParent) {
          return {
            procurementId: existingParent.id,
            suborderIds: [...existingParent.suborderIds],
          };
        }
      }
    }
    const location = this.getBasketLocation(ctx);
    if (!location) {
      throw forbiddenError("Выберите доступную точку доставки перед отправкой закупки.");
    }
    if (this.state.basket.lines.length === 0) {
      throw validationError("Корзина пуста.");
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

    const suborderIds: SuborderId[] = [];
    const remainingLines: BasketLine[] = [];

    for (const [supplierId, lines] of bySupplier) {
      const supplier = suppliers.get(supplierId);
      if (!supplier) continue;

      // Only submit a group when every line is valid, the minimum is met and
      // the supplier covers the selected location's zone.
      const group = computeSuborderGroup(
        supplier,
        lines
          .map((line) => {
            const offer = offers.get(line.offerId);
            return offer ? { line, offer } : null;
          })
          .filter((x): x is { line: BasketLine; offer: SupplierOffer } => x !== null),
        { nowIso: ctx.nowIso, locationZone: location.deliveryZone },
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
        locationId: location.id,
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
      throw validationError(
        "Нет ни одной готовой к отправке группы поставщика. Проверьте минимум, цены и зону доставки.",
      );
    }

    // Persist the parent together with its suborders in one commit (atomic).
    const parent: ParentProcurement = {
      id: asProcurementId(procurementId),
      orgId: this.state.basket.orgId,
      locationId: location.id,
      createdBy: ctx.membership.userId,
      status: "awaiting_supplier",
      createdAt: asIso(ctx.nowIso),
      suborderIds,
      reorderOfProcurementId: null,
    };
    next.parents = [...next.parents, parent];
    next.basket = { ...next.basket, lines: remainingLines };

    const metadata: Record<string, string | number | boolean> = {
      suborders: suborderIds.length,
      heldBack: remainingLines.length,
    };
    if (ctx.idempotencyKey) metadata.idempotencyKey = ctx.idempotencyKey;
    this.audit(
      next,
      ctx,
      "procurement.submit",
      "ParentProcurement",
      procurementId,
      metadata,
    );
    this.commit(next);
    return { procurementId, suborderIds };
  }

  /**
   * Read-only preview of what would be submitted: per ready supplier and per
   * held-back supplier with an exact reason. Used by the basket UI so a group
   * can be explained before submission. Never mutates state.
   */
  submitPreview(ctx: SessionContext): {
    location: BuyerLocation | undefined;
    ready: readonly { supplierId: string; supplierName: string }[];
    heldBack: readonly {
      supplierId: string;
      supplierName: string;
      blockers: readonly string[];
    }[];
  } {
    const location = this.getBasketLocation(ctx);
    const suppliers = this.suppliersById();
    const bySupplier = new Map<string, BasketLine[]>();
    for (const line of this.state.basket.lines) {
      const arr = bySupplier.get(line.supplierId) ?? [];
      arr.push(line);
      bySupplier.set(line.supplierId, arr);
    }
    const offers = this.offersById();
    const ready: { supplierId: string; supplierName: string }[] = [];
    const heldBack: {
      supplierId: string;
      supplierName: string;
      blockers: readonly string[];
    }[] = [];
    for (const [supplierId, lines] of bySupplier) {
      const supplier = suppliers.get(supplierId);
      if (!supplier) continue;
      const group = computeSuborderGroup(
        supplier,
        lines
          .map((line) => {
            const offer = offers.get(line.offerId);
            return offer ? { line, offer } : null;
          })
          .filter((x): x is { line: BasketLine; offer: SupplierOffer } => x !== null),
        { nowIso: ctx.nowIso, locationZone: location?.deliveryZone ?? null },
      );
      if (group.readyToSubmit) {
        ready.push({ supplierId: supplier.id, supplierName: supplier.displayName });
      } else {
        heldBack.push({
          supplierId: supplier.id,
          supplierName: supplier.displayName,
          blockers: group.blockers,
        });
      }
    }
    return { location, ready, heldBack };
  }

  /** Buyer confirms a specific suborder revision (accept). */
  buyerDecide(
    ctx: SessionContext,
    suborderId: SuborderId,
    outcome: "accepted" | "rejected",
    noteDemo: string | null,
    expectedVersion?: number,
  ): void {
    const suborder = this.state.suborders.find((s) => s.id === suborderId);
    if (!suborder) throw notFoundError("Подзаказ не найден.");
    if (
      !canViewSuborder(
        ctx.membership,
        suborder,
        this.locationsById().get(suborder.locationId),
      )
    ) {
      throw forbiddenError("Нет доступа к этому подзаказу.");
    }
    if (!canManageProcurement(ctx.membership, suborder.orgId)) {
      throw forbiddenError("Нет прав для решения по этому подзаказу.");
    }
    // Optimistic concurrency: refuse if the caller's view is stale.
    if (expectedVersion !== undefined && expectedVersion !== suborder.version) {
      throw conflictError(
        "Подзаказ изменился с момента открытия. Перечитайте текущую версию и решите снова.",
      );
    }
    const revision = this.state.revisions.find(
      (r) => r.id === suborder.currentRevisionId,
    );
    if (!revision) throw notFoundError("Текущая версия не найдена.");
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
    this.recomputeParentStatus(next, suborder.procurementId);
    this.audit(next, ctx, `suborder.${outcome}`, "SupplierSuborder", suborderId, {
      revisionId: revision.id,
    });
    this.commit(next);
  }

  /**
   * Aggregate the suborder states up to the parent. The parent NEVER hides a
   * branch: it is confirmed only when all are confirmed, rejected when all are
   * rejected, partially confirmed when some are confirmed and some are not, and
   * otherwise stays in negotiation.
   */
  private recomputeParentStatus(next: RepositoryState, procurementId: string): void {
    const children = next.suborders.filter((s) => s.procurementId === procurementId);
    if (children.length === 0) return;
    const all = (pred: (s: SupplierSuborder) => boolean): boolean => children.every(pred);
    const any = (pred: (s: SupplierSuborder) => boolean): boolean => children.some(pred);
    let status: ProcurementStatus;
    if (all((s) => s.status === "rejected")) status = "rejected";
    else if (all((s) => s.status === "confirmed")) status = "confirmed";
    else if (any((s) => s.status === "confirmed")) status = "partially_confirmed";
    else if (children.every((s) => s.status === "expired")) status = "expired";
    else if (children.every((s) => s.status === "cancelled")) status = "cancelled";
    else if (any((s) => s.status === "awaiting_buyer_decision"))
      status = "awaiting_buyer_decision";
    else status = "awaiting_supplier";
    next.parents = next.parents.map((p) =>
      p.id === procurementId ? { ...p, status } : p,
    );
  }

  /* -------------------- Supplier: catalog editing ---------------------- */

  updateOfferPrice(
    ctx: SessionContext,
    offerId: string,
    newAmount: number,
    expectedVersion?: number,
  ): void {
    const offer = this.state.offers.find((o) => o.id === offerId);
    if (!offer) throw notFoundError("Предложение не найдено.");
    if (!canEditSupplierCatalog(ctx.membership, offer.supplierId)) {
      throw forbiddenError("Нет прав на редактирование этого предложения.");
    }
    if (!Number.isInteger(newAmount) || newAmount <= 0) {
      throw validationError("Цена должна быть целым положительным числом тенге.");
    }
    if (expectedVersion !== undefined && expectedVersion !== offer.version) {
      throw conflictError(
        "Предложение изменилось с момента открытия. Перечитайте и сохраните снова.",
      );
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
    expectedVersion?: number,
  ): void {
    const offer = this.state.offers.find((o) => o.id === offerId);
    if (!offer) throw notFoundError("Предложение не найдено.");
    if (!canEditSupplierCatalog(ctx.membership, offer.supplierId)) {
      throw forbiddenError("Нет прав на редактирование этого предложения.");
    }
    if (expectedVersion !== undefined && expectedVersion !== offer.version) {
      throw conflictError(
        "Предложение изменилось с момента открытия. Перечитайте и сохраните снова.",
      );
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
    expectedVersion?: number,
  ): void {
    const suborder = this.state.suborders.find((s) => s.id === suborderId);
    if (!suborder) throw notFoundError("Подзаказ не найден.");
    if (!canRespondToSuborder(ctx.membership, suborder.supplierId)) {
      throw forbiddenError("Нет прав отвечать по этому подзаказу.");
    }
    if (expectedVersion !== undefined && expectedVersion !== suborder.version) {
      throw conflictError(
        "Подзаказ изменился с момента открытия. Перечитайте текущую версию.",
      );
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
    this.recomputeParentStatus(next, suborder.procurementId);
    this.audit(next, ctx, "suborder.propose_change", "SupplierSuborder", suborderId, {
      revisionNumber: nextNumber,
    });
    this.commit(next);
  }

  confirmSuborderNoChange(
    ctx: SessionContext,
    suborderId: SuborderId,
    expectedVersion?: number,
  ): void {
    const suborder = this.state.suborders.find((s) => s.id === suborderId);
    if (!suborder) throw notFoundError("Подзаказ не найден.");
    if (!canRespondToSuborder(ctx.membership, suborder.supplierId)) {
      throw forbiddenError("Нет прав отвечать по этому подзаказу.");
    }
    if (expectedVersion !== undefined && expectedVersion !== suborder.version) {
      throw conflictError(
        "Подзаказ изменился с момента открытия. Перечитайте текущую версию.",
      );
    }
    if (!canTransitionSuborder(suborder.status, "confirmed")) {
      throw conflictError(`Нельзя подтвердить из статуса ${suborder.status}.`);
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
    this.recomputeParentStatus(next, suborder.procurementId);
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
    if (!suborder) throw notFoundError("Подзаказ не найден.");
    if (to === "receiving" || to === "completed") {
      if (!canRecordReceiving(ctx.membership, suborder.orgId)) {
        throw forbiddenError("Нет прав фиксировать приёмку.");
      }
    } else {
      if (!canRespondToSuborder(ctx.membership, suborder.supplierId)) {
        throw forbiddenError("Нет прав продвигать исполнение.");
      }
    }
    if (
      !canStartFulfillment(suborder.status) &&
      suborder.fulfillmentStatus === "not_started"
    ) {
      throw conflictError("Нельзя начать исполнение до подтверждения заказа.");
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
    if (!suborder) throw notFoundError("Подзаказ не найден.");
    if (!canRecordReceiving(ctx.membership, suborder.orgId)) {
      throw forbiddenError("Нет прав фиксировать приёмку.");
    }
    // A receipt must belong to a suborder that is in the receiving stage.
    if (suborder.fulfillmentStatus !== "receiving") {
      throw conflictError("Приёмку можно записать только на этапе приёмки.");
    }
    for (const line of lines) {
      if (!Number.isInteger(line.receivedQuantity) || line.receivedQuantity < 0) {
        throw validationError("Полученное количество должно быть целым неотрицательным.");
      }
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
    if (!list) throw notFoundError("Список не найден.");
    if (!canManageBasket(ctx.membership, list.orgId)) {
      throw forbiddenError("Нет прав изменять список закупок.");
    }
    const offer = this.state.offers.find((o) => o.id === offerId);
    if (!offer) throw notFoundError("Предложение не найдено.");
    const next = cloneState(this.state);
    next.buyerLists = next.buyerLists.map((l) =>
      l.id === listId && !l.offerIds.includes(offerId as never)
        ? { ...l, offerIds: [...l.offerIds, offerId as never] }
        : l,
    );
    this.audit(next, ctx, "list.add", "BuyerList", listId, { offerId });
    this.commit(next);
  }

  /* ----------------------------- Reorder ------------------------------- */

  /**
   * Build and PERSIST a new draft basket from a source suborder.
   *
   * - Carries intent + SKU, never the old price/availability/snapshot.
   * - Re-checks live offers; missing / archived / unpriced items are returned
   *   as an explicit decision list, never silently dropped.
   * - Writes the carried lines into the acting org's basket (replacing carried
   *   offers in that basket) so the draft actually exists to edit.
   * - Never submits. Idempotent per `ctx.idempotencyKey`.
   */
  reorderIntoBasket(
    ctx: SessionContext,
    sourceSuborderId: SuborderId,
    newLineId: (n: number) => string = (n) => this.nextId(`bl-r${n}`),
  ): ReorderResult {
    const source = this.state.suborders.find((s) => s.id === sourceSuborderId);
    if (!source) throw notFoundError("Подзаказ не найден.");
    if (!canManageProcurement(ctx.membership, source.orgId)) {
      throw forbiddenError("Нет прав повторять эту закупку.");
    }
    if (ctx.idempotencyKey) {
      const prior = this.state.audit.find(
        (a) =>
          a.action === "basket.reorder" &&
          a.actorUserId === ctx.membership.userId &&
          a.metadata.idempotencyKey === ctx.idempotencyKey,
      );
      if (prior) {
        return {
          draft: { lines: [], flagged: [], summary: { carried: 0, flagged: 0 } },
          replayed: true,
        };
      }
    }

    const revision = this.state.revisions.find((r) => r.id === source.currentRevisionId);
    const sourceLines =
      source.confirmedLines ??
      revision?.lines.map((l) => ({
        offerId: l.offerId,
        quantity: l.quantityAfter ?? 1,
      })) ??
      [];
    const candidates = sourceLines.map((l) => {
      const offer = this.state.offers.find((o) => o.id === l.offerId) ?? null;
      return {
        offerId: l.offerId,
        supplierId: source.supplierId,
        title: offer?.title ?? "",
        requestedQuantity: l.quantity,
        liveOffer: offer,
      };
    });
    const draft = buildReorderDraft(candidates, ctx.nowIso, newLineId);

    const next = cloneState(this.state);
    const carriedLines: BasketLine[] = draft.lines
      .filter((l): l is Extract<typeof l, { kind: "carried" }> => l.kind === "carried")
      .map((l) => l.line);
    const carriedOfferIds = new Set(carriedLines.map((l) => l.offerId as string));
    const preserved = next.basket.lines.filter(
      (l) => !carriedOfferIds.has(l.offerId as string),
    );
    next.basket = { ...next.basket, lines: [...preserved, ...carriedLines] };

    const metadata: Record<string, string | number | boolean> = {
      carried: draft.summary.carried,
      flagged: draft.summary.flagged,
    };
    if (ctx.idempotencyKey) metadata.idempotencyKey = ctx.idempotencyKey;
    this.audit(
      next,
      ctx,
      "basket.reorder",
      "SupplierSuborder",
      sourceSuborderId,
      metadata,
    );
    this.commit(next);
    return { draft, replayed: false };
  }

  /* --------------------------- Import jobs ----------------------------- */

  /**
   * Apply a PARSED catalog import for a supplier, writing the resolved
   * Product/SupplierOffer rows into the repository and logging the job.
   *
   * Strategy: atomic. The caller passes already-resolved rows; if any row is in
   * error, the whole apply is refused (the UI disables apply when errors exist).
   * Re-importing the same SKU updates the offer rather than duplicating it.
   */
  applyCatalogImport(
    ctx: SessionContext,
    supplierId: SupplierProfile["id"],
    resolved: readonly ResolvedImportOffer[],
    summary: CatalogImportJob["summary"],
    parsedRows: CatalogImportJob["rows"],
  ): { jobId: string; appliedOfferIds: readonly OfferId[] } {
    if (!canEditSupplierCatalog(ctx.membership, supplierId)) {
      throw forbiddenError("Нет прав импортировать каталог этого поставщика.");
    }
    if (summary.errors > 0) {
      throw validationError(
        "Импорт отклонён целиком: в файле есть ошибочные строки. Исправьте их и повторите.",
      );
    }
    if (ctx.idempotencyKey) {
      const prior = this.state.audit.find(
        (a) =>
          a.action === "catalog.import.apply" &&
          a.actorUserId === ctx.membership.userId &&
          a.metadata.idempotencyKey === ctx.idempotencyKey,
      );
      if (prior) {
        const job = this.state.importJobs.find((j) => j.supplierId === supplierId);
        return { jobId: prior.entityId, appliedOfferIds: job?.appliedOfferIds ?? [] };
      }
    }

    const next = cloneState(this.state);
    const now = asIso(ctx.nowIso);
    const appliedOfferIds: OfferId[] = [];

    // Track seen SKUs to guarantee no duplicates within a single apply.
    const seenSkus = new Set<string>();

    for (const row of resolved) {
      if (seenSkus.has(row.sku)) {
        throw validationError(
          `Дубликат SKU ${row.sku} в одном импорте: применение отменено целиком.`,
        );
      }
      seenSkus.add(row.sku);

      const existing = next.offers.find(
        (o) => o.supplierId === supplierId && o.supplierSku === row.sku,
      );
      const productId = existing?.productId ?? asProductId(this.nextId("prod-imp"));

      if (!existing) {
        next.products = [
          ...next.products,
          {
            id: productId,
            name: row.title,
            category: row.category,
            brandDemo: null,
            manufacturerDemo: null,
            countryOfOriginDemo: null,
          },
        ];
      } else {
        next.products = next.products.map((p) =>
          p.id === productId ? { ...p, name: row.title, category: row.category } : p,
        );
      }

      const offer: SupplierOffer = {
        id: existing?.id ?? asOfferId(this.nextId("off-imp")),
        supplierId,
        productId,
        supplierSku: row.sku,
        title: row.title,
        packaging: {
          sellUnit: {
            label: row.sellUnitLabel,
            unitsPerSellUnit: row.unitsPerSellUnit,
            packSize: { amount: row.packAmount, baseUnit: row.packBaseUnit },
          },
          moq: row.moq,
          orderStep: row.orderStep,
        },
        pricePerSellUnit: { value: money(row.pricePerSellUnit), observedAt: now },
        availability: {
          value: row.availability,
          observedAt: row.availability === null ? null : now,
        },
        priceValidUntil: null,
        foodInfo: existing?.foodInfo ?? null,
        archived: false,
        version: existing ? existing.version + 1 : 1,
      };

      if (existing) {
        next.offers = next.offers.map((o) => (o.id === existing.id ? offer : o));
      } else {
        next.offers = [...next.offers, offer];
      }
      appliedOfferIds.push(offer.id);
    }

    const jobId = this.nextId("import");
    const job: CatalogImportJob = {
      id: asImportJobId(jobId),
      supplierId,
      createdAt: now,
      appliedOfferIds,
      rows: parsedRows,
      summary,
    };
    next.importJobs = [...next.importJobs, job];

    const metadata: Record<string, string | number | boolean> = {
      added: summary.added,
      updated: summary.updated,
      errors: summary.errors,
    };
    if (ctx.idempotencyKey) metadata.idempotencyKey = ctx.idempotencyKey;
    this.audit(next, ctx, "catalog.import.apply", "ImportJob", jobId, metadata);
    this.commit(next);
    return { jobId, appliedOfferIds };
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
