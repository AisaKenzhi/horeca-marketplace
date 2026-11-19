/**
 * Domain entities for the P0 prototype.
 *
 * These mirror the shape a real schema would take, but live as plain typed
 * objects backed by the in-browser mock repository. Nothing here talks to a
 * network. All example values elsewhere are clearly synthetic demo data.
 */

import type { AvailabilityStatus, TimestampedValue } from "./freshness";
import type { CurrencyCode, Money } from "./money";
import type { PackagingSpec } from "./packaging";
import type {
  AuditEventId,
  BasketId,
  BasketLineId,
  BuyerListId,
  BuyerLocationId,
  DecisionId,
  ImportJobId,
  IssueId,
  IsoTimestamp,
  MembershipId,
  NotificationId,
  OfferId,
  OrgId,
  ProductId,
  ProcurementId,
  ReceiptId,
  RevisionId,
  RevisionLineId,
  SuborderId,
  SuborderLineId,
  SupplierId,
  UserId,
} from "./ids";

/* ------------------------------------------------------------------ */
/* Access & organizations                                              */
/* ------------------------------------------------------------------ */

export type BuyerRole = "owner" | "admin" | "buyer" | "viewer" | "receiver";
export type SupplierRole = "owner" | "admin" | "catalog_operator" | "order_operator";
export type PlatformRole = "moderator" | "support" | "system_admin";
export type Role = BuyerRole | SupplierRole | PlatformRole;

export type MembershipSide = "buyer" | "supplier" | "platform";

export interface Membership {
  readonly id: MembershipId;
  readonly userId: UserId;
  /** Org for buyer/supplier side; platform "org" for operators. */
  readonly orgId: OrgId;
  readonly supplierId: SupplierId | null;
  readonly side: MembershipSide;
  readonly role: Role;
  readonly displayName: string;
  /** Demo-only marker. This is NOT real authentication. */
  readonly isDemo: true;
}

export interface Organization {
  readonly id: OrgId;
  readonly name: string;
  readonly isDemo: true;
}

export interface BuyerLocation {
  readonly id: BuyerLocationId;
  readonly orgId: OrgId;
  readonly name: string;
  readonly addressDemo: string;
  /** Delivery zone key used to check supplier coverage. Demo values only. */
  readonly deliveryZone: string;
}

export interface SupplierProfile {
  readonly id: SupplierId;
  readonly orgId: OrgId;
  readonly displayName: string;
  /** City/coverage label. Demo text. */
  readonly coverageDemo: string;
  readonly deliveryZones: readonly string[];
  /** Supplier-wide minimum order value, separate from per-line MOQ. */
  readonly minimumOrderValue: Money;
  /** Free-delivery threshold, or null when unknown / not offered. */
  readonly freeDeliveryThreshold: Money | null;
  /** Delivery fee rule, or null when the fee is genuinely unknown. */
  readonly deliveryFee: Money | null;
  readonly deliveryDaysDemo: readonly string[];
  readonly deliveryWindowsDemo: readonly string[];
  /** Supplier is a draft/demo storefront; not published anywhere. */
  readonly storefrontState: "draft_demo";
}

/* ------------------------------------------------------------------ */
/* Products & offers                                                   */
/* ------------------------------------------------------------------ */

export interface Product {
  readonly id: ProductId;
  /** Normalized descriptive name (demo). */
  readonly name: string;
  readonly category: string;
  readonly brandDemo: string | null;
  readonly manufacturerDemo: string | null;
  readonly countryOfOriginDemo: string | null;
}

/** Extensible food-information fields. Demo values only; no compliance claim. */
export interface FoodInfoDemo {
  readonly ingredientsDemo: string | null;
  readonly allergensDemo: readonly string[];
  readonly storageDemo: string | null;
  readonly labelNotesDemo: string | null;
  /** Fields that are merely *available*; they do not imply verified quality. */
  readonly fieldsPresent: readonly string[];
}

/**
 * A supplier_offer is a specific SKU from a specific supplier.
 * A normalized Product may be shared, but offers are NEVER merged across
 * suppliers in a way that loses the seller, packaging, or price source.
 */
export interface SupplierOffer {
  readonly id: OfferId;
  readonly supplierId: SupplierId;
  readonly productId: ProductId;
  /** The supplier's own SKU code. */
  readonly supplierSku: string;
  readonly title: string;
  readonly packaging: PackagingSpec;
  readonly pricePerSellUnit: TimestampedValue<Money>;
  readonly availability: TimestampedValue<AvailabilityStatus>;
  /** Optional explicit price validity end. Null = not stated. */
  readonly priceValidUntil: string | null;
  readonly foodInfo: FoodInfoDemo | null;
  /** Soft lifecycle flag. Archived offers are hidden from the catalog. */
  readonly archived: boolean;
  /** Optimistic-concurrency version, incremented on each supplier edit. */
  readonly version: number;
}

/* ------------------------------------------------------------------ */
/* Buyer lists, basket, procurement                                    */
/* ------------------------------------------------------------------ */

export interface BuyerList {
  readonly id: BuyerListId;
  readonly orgId: OrgId;
  readonly name: string;
  readonly offerIds: readonly OfferId[];
}

export interface BasketLine {
  readonly id: BasketLineId;
  readonly offerId: OfferId;
  readonly supplierId: SupplierId;
  /** Requested quantity in SELL UNITS. */
  readonly quantity: number;
  /**
   * Snapshot of the price at the moment the line was added, so we can show a
   * delta when the live price later changes. Never silently overwritten.
   */
  readonly addedAtPriceSnapshot: Money | null;
  readonly addedAt: IsoTimestamp;
}

export interface Basket {
  readonly id: BasketId;
  readonly orgId: OrgId;
  readonly locationId: BuyerLocationId;
  readonly lines: readonly BasketLine[];
}

export type ProcurementStatus =
  | "draft"
  | "awaiting_supplier"
  | "awaiting_buyer_decision"
  | "confirmed"
  | "partially_confirmed"
  | "rejected"
  | "expired"
  | "cancelled";

export interface ParentProcurement {
  readonly id: ProcurementId;
  readonly orgId: OrgId;
  readonly locationId: BuyerLocationId;
  readonly createdBy: UserId;
  readonly status: ProcurementStatus;
  readonly createdAt: IsoTimestamp;
  readonly suborderIds: readonly SuborderId[];
  /** If this procurement originated from a reorder, the source it came from. */
  readonly reorderOfProcurementId: ProcurementId | null;
}

export type SuborderStatus =
  | "draft"
  | "submitted"
  | "awaiting_supplier"
  | "change_proposed"
  | "awaiting_buyer_decision"
  | "confirmed"
  | "partially_confirmed"
  | "rejected"
  | "expired"
  | "cancelled";

export type FulfillmentStatus =
  | "not_started"
  | "packing"
  | "ready_for_handover"
  | "shipped"
  | "delivered"
  | "receiving"
  | "completed";

export type PaymentStatus = "not_applicable_demo" | "not_processed";

/** A confirmed snapshot of one line at a specific revision. */
export interface SuborderLineSnapshot {
  readonly id: SuborderLineId;
  readonly offerId: OfferId;
  readonly title: string;
  readonly quantity: number;
  readonly pricePerSellUnit: Money;
  readonly sellUnitLabel: string;
}

export interface SupplierSuborder {
  readonly id: SuborderId;
  readonly procurementId: ProcurementId;
  readonly supplierId: SupplierId;
  readonly orgId: OrgId;
  readonly locationId: BuyerLocationId;
  readonly status: SuborderStatus;
  readonly fulfillmentStatus: FulfillmentStatus;
  /** Payment is a separate dimension and is never processed in P0. */
  readonly paymentStatus: PaymentStatus;
  /** The currently binding line snapshot, set only on confirmation. */
  readonly confirmedLines: readonly SuborderLineSnapshot[] | null;
  readonly currentRevisionId: RevisionId;
  readonly createdAt: IsoTimestamp;
  readonly updatedAt: IsoTimestamp;
  /** Optimistic-concurrency version, guards concurrent buyer/supplier edits. */
  readonly version: number;
}

/* ------------------------------------------------------------------ */
/* Revisions & decisions                                               */
/* ------------------------------------------------------------------ */

export type RevisionAuthor =
  { kind: "supplier"; supplierId: SupplierId } | { kind: "buyer"; userId: UserId };

export interface RevisionLine {
  readonly id: RevisionLineId;
  readonly offerId: OfferId;
  readonly changeKind:
    | "unchanged"
    | "price_changed"
    | "quantity_changed"
    | "packaging_changed"
    | "substituted"
    | "delivery_window_changed";
  /** Quantities in sell units. */
  readonly quantityBefore: number | null;
  readonly quantityAfter: number | null;
  readonly priceBefore: Money | null;
  readonly priceAfter: Money | null;
  readonly sellUnitLabelBefore: string | null;
  readonly sellUnitLabelAfter: string | null;
  /** For substitutions: the replaced offer and its replacement. */
  readonly substitutedFromOfferId: OfferId | null;
  readonly substitutedToOfferId: OfferId | null;
  /** Human reason shown with the change; demo text. */
  readonly reasonDemo: string;
}

export interface SuborderRevision {
  readonly id: RevisionId;
  readonly suborderId: SuborderId;
  /** Monotonic revision number, starting at 1. */
  readonly revisionNumber: number;
  readonly author: RevisionAuthor;
  readonly createdAt: IsoTimestamp;
  readonly lines: readonly RevisionLine[];
  /** Delivery window proposed in this revision (demo text), or null. */
  readonly deliveryWindowDemo: string | null;
}

export type BuyerDecisionOutcome = "accepted" | "rejected";

/**
 * An explicit buyer decision recorded for ONE revision. A revision only binds
 * once a decision for that exact revision exists. Silence is never consent.
 */
export interface BuyerDecision {
  readonly id: DecisionId;
  readonly suborderId: SuborderId;
  readonly revisionId: RevisionId;
  readonly outcome: BuyerDecisionOutcome;
  readonly decidedBy: UserId;
  readonly decidedAt: IsoTimestamp;
  readonly noteDemo: string | null;
}

/* ------------------------------------------------------------------ */
/* Fulfillment, receipt, issues                                        */
/* ------------------------------------------------------------------ */

export type FulfillmentEventType =
  | "status_changed"
  | "shipped"
  | "delivered"
  | "receiving_started"
  | "receiving_completed";

export interface FulfillmentEvent {
  readonly id: string;
  readonly suborderId: SuborderId;
  readonly type: FulfillmentEventType;
  readonly fromStatus: FulfillmentStatus | null;
  readonly toStatus: FulfillmentStatus | null;
  readonly at: IsoTimestamp;
  /** Idempotency key; re-processing the same event must not duplicate. */
  readonly idempotencyKey: string;
}

export interface ReceiptLine {
  readonly offerId: OfferId;
  readonly expectedQuantity: number;
  readonly receivedQuantity: number;
}

export type DiscrepancyReason =
  | "shortage"
  | "wrong_item"
  | "unapproved_substitution"
  | "damaged"
  | "expired"
  | "temperature"
  | "delay";

/**
 * A receipt record documents what was OBSERVED. It does not decide a dispute,
 * compensation, refund, or arbitration.
 */
export interface ReceiptRecord {
  readonly id: ReceiptId;
  readonly suborderId: SuborderId;
  readonly recordedBy: UserId;
  readonly recordedAt: IsoTimestamp;
  readonly lines: readonly ReceiptLine[];
  readonly notedDiscrepancies: readonly DiscrepancyReason[];
}

export interface Issue {
  readonly id: IssueId;
  readonly suborderId: SuborderId;
  readonly reason: DiscrepancyReason;
  readonly descriptionDemo: string;
  readonly openedBy: UserId;
  readonly openedAt: IsoTimestamp;
  readonly state: "open_demo" | "acknowledged_demo";
}

/* ------------------------------------------------------------------ */
/* Imports, notifications, audit                                       */
/* ------------------------------------------------------------------ */

export type ImportRowStatus = "added" | "updated" | "error" | "skipped";

export interface ImportRowResult {
  readonly rowNumber: number;
  readonly status: ImportRowStatus;
  /** Field-level errors, e.g. "price: must be a positive integer". */
  readonly errors: readonly string[];
  readonly sku: string | null;
}

export interface CatalogImportJob {
  readonly id: ImportJobId;
  readonly supplierId: SupplierId;
  readonly createdAt: IsoTimestamp;
  /** Local-only: the applied changes can be reverted while the job is in session. */
  readonly appliedOfferIds: readonly OfferId[];
  readonly rows: readonly ImportRowResult[];
  readonly summary: {
    readonly added: number;
    readonly updated: number;
    readonly errors: number;
    readonly skipped: number;
  };
}

export type NotificationChannelDemo = "inbox" | "toast";

/** P0 notifications are local demo records only. No email/SMS/push is sent. */
export interface NotificationEvent {
  readonly id: NotificationId;
  readonly channel: NotificationChannelDemo;
  readonly audienceUserId: UserId;
  readonly titleDemo: string;
  readonly bodyDemo: string;
  readonly createdAt: IsoTimestamp;
  readonly read: boolean;
  /** Dedup key so a re-processed event does not create a duplicate. */
  readonly dedupKey: string;
}

export interface AuditEvent {
  readonly id: AuditEventId;
  readonly at: IsoTimestamp;
  readonly actorUserId: UserId | null;
  readonly actorRole: Role | null;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  /** Small, non-sensitive metadata bag. Never store PII or secrets here. */
  readonly metadata: Readonly<Record<string, string | number | boolean>>;
}

export interface CurrencyExport {
  readonly defaultCurrency: CurrencyCode;
}
