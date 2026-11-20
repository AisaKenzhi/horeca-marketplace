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
  asBasketId,
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
  canCancelSuborder,
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
  /**
   * One basket per buyer org. In a multi-tenant product each organization has
   * its own basket; a single shared basket would let one org's lines leak into
   * (or block) another's. Look baskets up by `orgId`, never by position.
   */
  baskets: Basket[];
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
  baskets: readonly Basket[];
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
    baskets: seed.baskets.map((b) => structuredClone(b)),
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

/**
 * True when writing `row` over `offer` would change nothing. Used to keep a
 * re-import a true no-op (no version bump, no observedAt drift) at the
 * repository boundary. Deliberately compares only the values an import writes,
 * with the same reachability the writer uses. `observedAt` timestamps are NOT
 * compared: they move on every write and are not part of the row.
 */
function offerMatchesResolvedRow(
  offer: SupplierOffer,
  row: ResolvedImportOffer,
): boolean {
  const price = offer.pricePerSellUnit.value;
  return (
    offer.title === row.title &&
    offer.packaging.sellUnit.label === row.sellUnitLabel &&
    offer.packaging.sellUnit.unitsPerSellUnit === row.unitsPerSellUnit &&
    offer.packaging.sellUnit.packSize.amount === row.packAmount &&
    offer.packaging.sellUnit.packSize.baseUnit === row.packBaseUnit &&
    offer.packaging.moq === row.moq &&
    offer.packaging.orderStep === row.orderStep &&
    price !== null &&
    price.amount === row.pricePerSellUnit &&
    offer.availability.value === row.availability &&
    offer.archived === false
  );
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

  /**
   * The basket for an org, or undefined. Baskets are keyed by orgId; there is
   * never a shared/global basket, so one tenant can't read or block another's.
   */
  private findBasket(state: RepositoryState, orgId: string): Basket | undefined {
    return state.baskets.find((b) => b.orgId === orgId);
  }

  /** An empty basket for an org that has not started one yet. */
  private emptyBasketFor(orgId: string): Basket {
    return {
      id: asBasketId(`basket-${orgId}`),
      orgId: orgId as Basket["orgId"],
      // No location is pre-selected; the buyer must choose one explicitly.
      locationId: "" as Basket["locationId"],
      lines: [],
    };
  }

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

  /**
   * Raw, UNSEALED parent lookup by id. This is an internal accessor (used by
   * `getVisibleParent` and tests) and MUST NOT be handed a caller's id in UI or
   * server code — use `getVisibleParent` for anything user-facing. A foreign id
   * here would leak the parent object, so treat the argument as trusted.
   */
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

  /**
   * Raw, UNSEALED suborder list for a parent (all branches, all suppliers). An
   * internal accessor used by `getVisibleParent`/`visibleSubordersOf` and tests.
   * Never call this with a caller-supplied id in UI/server code; use
   * `visibleSubordersOf` (tenant-checked) instead.
   */
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
    const basket = this.findBasket(this.state, ctx.membership.orgId);
    if (!basket) {
      // No basket yet for this org: an empty one, never another org's.
      return this.emptyBasketFor(ctx.membership.orgId);
    }
    // Only expose the lines if the acting member may access the location the
    // basket is bound to. This is defence in depth on top of the org keying.
    const loc = this.locationsById().get(basket.locationId);
    if (basket.locationId !== "" && !canAccessLocation(ctx.membership, loc)) {
      return { ...basket, lines: [] };
    }
    return basket;
  }

  /** The buyer's current deliver-to location for the basket, tenant-checked. */
  getBasketLocation(ctx: SessionContext): BuyerLocation | undefined {
    const basket = this.findBasket(this.state, ctx.membership.orgId);
    if (!basket || basket.locationId === "") return undefined;
    const loc = this.locationsById().get(basket.locationId);
    return canAccessLocation(ctx.membership, loc) ? loc : undefined;
  }

  /**
   * Select which of the org's locations the basket delivers to. The location
   * must belong to the acting buyer org; it is never inferred from "the first".
   */
  setBasketLocation(ctx: SessionContext, locationId: string): void {
    if (!canManageBasket(ctx.membership, ctx.membership.orgId)) {
      throw forbiddenError("Недостаточно прав для изменения точки доставки.");
    }
    const loc = this.state.buyerLocations.find((l) => l.id === locationId);
    if (!loc) throw notFoundError("Точка доставки не найдена.");
    if (!canAccessLocation(ctx.membership, loc)) {
      throw forbiddenError("Эта точка доставки недоступна вашей организации.");
    }
    const next = cloneState(this.state);
    const basket =
      this.findBasket(next, ctx.membership.orgId) ??
      this.emptyBasketFor(ctx.membership.orgId);
    const updated: Basket = { ...basket, locationId: loc.id };
    next.baskets = this.findBasket(next, ctx.membership.orgId)
      ? next.baskets.map((b) => (b.orgId === ctx.membership.orgId ? updated : b))
      : [...next.baskets, updated];
    this.audit(next, ctx, "basket.setLocation", "BuyerLocation", locationId);
    this.commit(next);
  }

  addToBasket(ctx: SessionContext, offerId: string, quantity: number): void {
    if (!canManageBasket(ctx.membership, ctx.membership.orgId)) {
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
    const basket =
      this.findBasket(next, ctx.membership.orgId) ??
      this.emptyBasketFor(ctx.membership.orgId);
    const existing = basket.lines.find((l) => l.offerId === offerId);
    let lines: readonly BasketLine[];
    if (existing) {
      lines = basket.lines.map((l) =>
        l.offerId === offerId ? { ...l, quantity: l.quantity + quantity } : l,
      );
    } else {
      const line: BasketLine = {
        id: asBasketLineId(this.nextId("bl")),
        offerId: offer.id,
        supplierId: offer.supplierId,
        quantity,
        addedAtPriceSnapshot: offer.pricePerSellUnit.value,
        addedAt: asIso(ctx.nowIso),
      };
      lines = [...basket.lines, line];
    }
    const updated: Basket = { ...basket, lines };
    next.baskets = this.findBasket(next, ctx.membership.orgId)
      ? next.baskets.map((b) => (b.orgId === ctx.membership.orgId ? updated : b))
      : [...next.baskets, updated];
    this.audit(next, ctx, "basket.add", "SupplierOffer", offerId, { quantity });
    this.commit(next);
  }

  setBasketLineQuantity(
    ctx: SessionContext,
    lineId: BasketLineId,
    quantity: number,
  ): void {
    if (!canManageBasket(ctx.membership, ctx.membership.orgId)) {
      throw forbiddenError("Недостаточно прав для изменения корзины.");
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw validationError("Количество должно быть целым положительным числом.");
    }
    const basket = this.findBasket(this.state, ctx.membership.orgId);
    if (!basket || !basket.lines.some((l) => l.id === lineId)) {
      throw notFoundError("Строка корзины не найдена.");
    }
    const next = cloneState(this.state);
    next.baskets = next.baskets.map((b) =>
      b.orgId === ctx.membership.orgId
        ? {
            ...b,
            lines: b.lines.map((l) =>
              l.id === lineId
                ? // Refresh the snapshot so a deliberate quantity change
                  // re-baselines the price the buyer is looking at.
                  {
                    ...l,
                    quantity,
                    addedAtPriceSnapshot: this.livePriceFor(l.offerId),
                  }
                : l,
            ),
          }
        : b,
    );
    this.audit(next, ctx, "basket.setQuantity", "BasketLine", lineId, { quantity });
    this.commit(next);
  }

  removeBasketLine(ctx: SessionContext, lineId: BasketLineId): void {
    if (!canManageBasket(ctx.membership, ctx.membership.orgId)) {
      throw forbiddenError("Недостаточно прав для изменения корзины.");
    }
    const basket = this.findBasket(this.state, ctx.membership.orgId);
    if (!basket || !basket.lines.some((l) => l.id === lineId)) {
      throw notFoundError("Строка корзины не найдена.");
    }
    const next = cloneState(this.state);
    next.baskets = next.baskets.map((b) =>
      b.orgId === ctx.membership.orgId
        ? { ...b, lines: b.lines.filter((l) => l.id !== lineId) }
        : b,
    );
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
    if (!canManageProcurement(ctx.membership, ctx.membership.orgId)) {
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
    const ownBasket = this.findBasket(this.state, ctx.membership.orgId);
    if (!ownBasket || ownBasket.lines.length === 0) {
      throw validationError("Корзина пуста.");
    }

    const offers = this.offersById();
    const suppliers = this.suppliersById();
    const next = cloneState(this.state);
    const procurementId = this.nextId("proc");

    const bySupplier = new Map<string, BasketLine[]>();
    for (const line of ownBasket.lines) {
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
        orgId: ctx.membership.orgId,
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
      orgId: ctx.membership.orgId,
      locationId: location.id,
      createdBy: ctx.membership.userId,
      status: "awaiting_supplier",
      createdAt: asIso(ctx.nowIso),
      suborderIds,
      reorderOfProcurementId: null,
    };
    next.parents = [...next.parents, parent];
    next.baskets = next.baskets.map((b) =>
      b.orgId === ctx.membership.orgId ? { ...b, lines: remainingLines } : b,
    );

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
    const ownBasket = this.findBasket(this.state, ctx.membership.orgId);
    for (const line of ownBasket?.lines ?? []) {
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
   * branch: it is confirmed only when all are confirmed, rejected only when all
   * are rejected, and shows a partial/negotiation state otherwise. The final
   * `awaiting_supplier` fallback is reached ONLY when at least one child is
   * genuinely still pending — a mix of terminal states never falls through to
   * "awaiting supplier".
   */
  private recomputeParentStatus(next: RepositoryState, procurementId: string): void {
    const children = next.suborders.filter((s) => s.procurementId === procurementId);
    if (children.length === 0) return;
    const all = (pred: (s: SupplierSuborder) => boolean): boolean => children.every(pred);
    const any = (pred: (s: SupplierSuborder) => boolean): boolean => children.some(pred);
    const isTerminal = (s: SupplierSuborder): boolean =>
      s.status === "rejected" || s.status === "expired" || s.status === "cancelled";

    let status: ProcurementStatus;
    if (all((s) => s.status === "rejected")) status = "rejected";
    else if (all((s) => s.status === "confirmed")) status = "confirmed";
    else if (all((s) => s.status === "cancelled")) status = "cancelled";
    else if (all((s) => s.status === "expired")) status = "expired";
    else if (any((s) => s.status === "confirmed")) status = "partially_confirmed";
    else if (any((s) => s.status === "awaiting_buyer_decision"))
      status = "awaiting_buyer_decision";
    else if (all(isTerminal)) {
      // Every branch reached a terminal outcome, but they differ (e.g. one
      // rejected, one cancelled). Never claim the parent is still awaiting a
      // supplier; surface it as a mixed rejected outcome.
      status = "rejected";
    } else status = "awaiting_supplier";
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

  /**
   * Cancel exactly ONE suborder branch.
   *
   * - Branch-scoped: siblings are never touched; the parent status is recomputed
   *   from children afterwards.
   * - Role-checked via `canCancelSuborder` (owning buyer org, or the branch's own
   *   supplier). A foreign supplier/org, viewer or receiver is refused.
   * - State-machine checked: only an allowed transition to `cancelled` proceeds.
   * - Idempotent: cancelling an already-cancelled branch is a no-op (no second
   *   audit event), so a retry after an unclear outcome is safe.
   * - Optimistic concurrency: a stale `expectedVersion` is refused.
   *
   * NOTE (honesty): there is no reservation/inventory ledger in this prototype,
   * so cancellation cannot release a real reservation. It records that fact in
   * the audit metadata instead of pretending a reservation was released.
   */
  cancelSuborder(
    ctx: SessionContext,
    suborderId: SuborderId,
    reasonDemo: string | null,
    expectedVersion?: number,
  ): void {
    const suborder = this.state.suborders.find((s) => s.id === suborderId);
    if (!suborder) throw notFoundError("Подзаказ не найден.");
    if (!canCancelSuborder(ctx.membership, suborder)) {
      throw forbiddenError("Нет прав отменить этот подзаказ.");
    }
    // Idempotent replay: an already-cancelled branch is a safe no-op.
    if (suborder.status === "cancelled") return;
    if (expectedVersion !== undefined && expectedVersion !== suborder.version) {
      throw conflictError(
        "Подзаказ изменился с момента открытия. Перечитайте текущую версию.",
      );
    }
    if (!canTransitionSuborder(suborder.status, "cancelled")) {
      throw conflictError(`Нельзя отменить подзаказ из статуса ${suborder.status}.`);
    }
    const next = cloneState(this.state);
    const now = asIso(ctx.nowIso);
    next.suborders = next.suborders.map((s) =>
      s.id === suborderId
        ? { ...s, status: "cancelled" as const, updatedAt: now, version: s.version + 1 }
        : s,
    );
    this.recomputeParentStatus(next, suborder.procurementId);
    const metadata: Record<string, string | number | boolean> = {
      fromStatus: suborder.status,
      // No inventory ledger exists here; a real backend must release its own
      // reservation for this branch at this point.
      reservationReleased: false,
    };
    if (reasonDemo !== null) metadata.reasonDemo = reasonDemo;
    this.audit(next, ctx, "suborder.cancel", "SupplierSuborder", suborderId, metadata);
    this.commit(next);
  }

  /* ---------------------- Fulfillment / receiving ---------------------- */

  advanceFulfillment(
    ctx: SessionContext,
    suborderId: SuborderId,
    to: FulfillmentStatus,
    expectedVersion?: number,
  ): void {
    const suborder = this.state.suborders.find((s) => s.id === suborderId);
    if (!suborder) throw notFoundError("Подзаказ не найден.");
    if (expectedVersion !== undefined && expectedVersion !== suborder.version) {
      throw conflictError(
        "Подзаказ изменился с момента открытия. Перечитайте текущую версию.",
      );
    }
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
    expectedVersion?: number,
  ): void {
    const suborder = this.state.suborders.find((s) => s.id === suborderId);
    if (!suborder) throw notFoundError("Подзаказ не найден.");
    if (!canRecordReceiving(ctx.membership, suborder.orgId)) {
      throw forbiddenError("Нет прав фиксировать приёмку.");
    }
    if (expectedVersion !== undefined && expectedVersion !== suborder.version) {
      throw conflictError(
        "Подзаказ изменился с момента открытия. Перечитайте текущую версию.",
      );
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
    // Recording a receipt is a write to the suborder: bump its version so the
    // optimistic-concurrency check is meaningful against a second receiver.
    next.suborders = next.suborders.map((s) =>
      s.id === suborderId ? { ...s, updatedAt: now, version: s.version + 1 } : s,
    );
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
    const target = this.findBasket(next, ctx.membership.orgId);
    const base: Basket = target ?? this.emptyBasketFor(ctx.membership.orgId);
    const preserved = base.lines.filter((l) => !carriedOfferIds.has(l.offerId as string));
    const updated: Basket = { ...base, lines: [...preserved, ...carriedLines] };
    next.baskets = target
      ? next.baskets.map((b) => (b.orgId === ctx.membership.orgId ? updated : b))
      : [...next.baskets, updated];

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
        const job = this.state.importJobs.find((j) => j.id === prior.entityId);
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

      // Boundary validation: never trust the caller's resolved numbers. A price,
      // MOQ, step, units-per-sell-unit or pack amount that is not a positive
      // integer would corrupt the catalog (a negative price, a zero MOQ). The
      // domain resolver also checks these, but the repository is the boundary.
      if (!Number.isInteger(row.pricePerSellUnit) || row.pricePerSellUnit <= 0) {
        throw validationError(
          `SKU ${row.sku}: цена должна быть целым положительным числом тенге.`,
        );
      }
      if (!Number.isInteger(row.moq) || row.moq <= 0) {
        throw validationError(`SKU ${row.sku}: MOQ должен быть целым положительным.`);
      }
      if (!Number.isInteger(row.orderStep) || row.orderStep <= 0) {
        throw validationError(
          `SKU ${row.sku}: шаг заказа должен быть целым положительным.`,
        );
      }
      if (!Number.isInteger(row.unitsPerSellUnit) || row.unitsPerSellUnit <= 0) {
        throw validationError(
          `SKU ${row.sku}: число единиц в продаваемой единице должно быть целым положительным.`,
        );
      }
      if (!Number.isFinite(row.packAmount) || row.packAmount <= 0) {
        throw validationError(
          `SKU ${row.sku}: размер фасовки должен быть положительным.`,
        );
      }
      if (row.sku === "" || row.title === "") {
        throw validationError(`Строка без SKU или названия отклонена целиком.`);
      }

      const existing = next.offers.find(
        (o) => o.supplierId === supplierId && o.supplierSku === row.sku,
      );

      // Re-import must be a no-op for an identical row: never bump the version
      // of an offer whose values would not change (defends the "re-import writes
      // nothing" guarantee at the boundary, not only in the domain resolver).
      if (existing && offerMatchesResolvedRow(existing, row)) {
        continue;
      }

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
