/**
 * Branded identifier types.
 *
 * The prototype deliberately distinguishes ids at the type level so that a
 * `SupplierId` can never be silently used where a `ProductId` is expected.
 * This is a compile-time guard only; it does not replace server-side
 * authorization in a future real product.
 */

declare const brandTag: unique symbol;
type Brand<T, B extends string> = T & { readonly [brandTag]: B };

export type OrgId = Brand<string, "OrgId">;
export type MembershipId = Brand<string, "MembershipId">;
export type BuyerLocationId = Brand<string, "BuyerLocationId">;
export type SupplierId = Brand<string, "SupplierId">;
export type ProductId = Brand<string, "ProductId">;
export type OfferId = Brand<string, "OfferId">;
export type BuyerListId = Brand<string, "BuyerListId">;
export type BasketId = Brand<string, "BasketId">;
export type BasketLineId = Brand<string, "BasketLineId">;
export type ProcurementId = Brand<string, "ProcurementId">;
export type SuborderId = Brand<string, "SuborderId">;
export type SuborderLineId = Brand<string, "SuborderLineId">;
export type RevisionId = Brand<string, "RevisionId">;
export type RevisionLineId = Brand<string, "RevisionLineId">;
export type DecisionId = Brand<string, "DecisionId">;
export type FulfillmentEventId = Brand<string, "FulfillmentEventId">;
export type ReceiptId = Brand<string, "ReceiptId">;
export type IssueId = Brand<string, "IssueId">;
export type ImportJobId = Brand<string, "ImportJobId">;
export type NotificationId = Brand<string, "NotificationId">;
export type AuditEventId = Brand<string, "AuditEventId">;
export type UserId = Brand<string, "UserId">;

/** ISO-8601 UTC timestamp string, e.g. "2026-11-19T13:00:00.000Z". */
export type IsoTimestamp = Brand<string, "IsoTimestamp">;

const brand = <T extends string>(value: string): T => value as T;
export const asOrgId = (v: string): OrgId => brand<OrgId>(v);
export const asMembershipId = (v: string): MembershipId => brand<MembershipId>(v);
export const asBuyerLocationId = (v: string): BuyerLocationId =>
  brand<BuyerLocationId>(v);
export const asSupplierId = (v: string): SupplierId => brand<SupplierId>(v);
export const asProductId = (v: string): ProductId => brand<ProductId>(v);
export const asOfferId = (v: string): OfferId => brand<OfferId>(v);
export const asBuyerListId = (v: string): BuyerListId => brand<BuyerListId>(v);
export const asBasketId = (v: string): BasketId => brand<BasketId>(v);
export const asBasketLineId = (v: string): BasketLineId => brand<BasketLineId>(v);
export const asProcurementId = (v: string): ProcurementId => brand<ProcurementId>(v);
export const asSuborderId = (v: string): SuborderId => brand<SuborderId>(v);
export const asSuborderLineId = (v: string): SuborderLineId => brand<SuborderLineId>(v);
export const asRevisionId = (v: string): RevisionId => brand<RevisionId>(v);
export const asRevisionLineId = (v: string): RevisionLineId => brand<RevisionLineId>(v);
export const asDecisionId = (v: string): DecisionId => brand<DecisionId>(v);
export const asFulfillmentEventId = (v: string): FulfillmentEventId =>
  brand<FulfillmentEventId>(v);
export const asReceiptId = (v: string): ReceiptId => brand<ReceiptId>(v);
export const asIssueId = (v: string): IssueId => brand<IssueId>(v);
export const asImportJobId = (v: string): ImportJobId => brand<ImportJobId>(v);
export const asNotificationId = (v: string): NotificationId => brand<NotificationId>(v);
export const asAuditEventId = (v: string): AuditEventId => brand<AuditEventId>(v);
export const asUserId = (v: string): UserId => brand<UserId>(v);

/** Parse/cast an arbitrary string into an IsoTimestamp without validating format. */
export const asIso = (v: string): IsoTimestamp => brand<IsoTimestamp>(v);
