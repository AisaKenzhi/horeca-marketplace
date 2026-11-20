/**
 * Authorization policy.
 *
 * In a real product these checks must run at the data/server boundary, not just
 * in the UI. In this P0 prototype the "server" is the in-browser repository, so
 * these pure functions are the enforcement point and are unit-tested for
 * cross-tenant leakage.
 *
 * Key rules:
 *   - A buyer org only sees its own data.
 *   - A supplier only sees its own offers and its own suborders.
 *   - A supplier never sees a sibling supplier's suborder.
 *   - An operator sees only what a specific task needs; no silent data editing.
 *   - Caller-supplied ids are DATA, not authorization.
 */

import type {
  BuyerLocation,
  Membership,
  Organization,
  SupplierProfile,
  SupplierSuborder,
} from "./entities";

export function isBuyerSide(m: Membership): boolean {
  return m.side === "buyer";
}
export function isSupplierSide(m: Membership): boolean {
  return m.side === "supplier";
}
export function isPlatformSide(m: Membership): boolean {
  return m.side === "platform";
}

/** Can this membership read data belonging to `orgId` on the buyer side? */
export function canAccessBuyerOrg(m: Membership, orgId: Organization["id"]): boolean {
  return isBuyerSide(m) && m.orgId === orgId;
}

/**
 * Can this membership use a specific buyer location? The location's org must
 * match the membership's org. A location is NEVER inferred from "the first one".
 */
export function canAccessLocation(
  m: Membership,
  location: BuyerLocation | undefined,
): boolean {
  if (location === undefined) return false;
  return canAccessBuyerOrg(m, location.orgId);
}

/**
 * Can this membership manage the buyer basket for the org (add/edit/remove)?
 * Viewers and receivers cannot. Owner/admin/buyer can.
 */
export function canManageBasket(m: Membership, orgId: Organization["id"]): boolean {
  if (!canAccessBuyerOrg(m, orgId)) return false;
  return m.role === "owner" || m.role === "admin" || m.role === "buyer";
}

/**
 * Can this membership manage (create/edit) procurement for the org?
 * Viewers and receivers cannot. Owner/admin/buyer can.
 */
export function canManageProcurement(m: Membership, orgId: Organization["id"]): boolean {
  if (!canAccessBuyerOrg(m, orgId)) return false;
  return m.role === "owner" || m.role === "admin" || m.role === "buyer";
}

/** Receivers can record receiving but not edit order terms. */
export function canRecordReceiving(m: Membership, orgId: Organization["id"]): boolean {
  if (!canAccessBuyerOrg(m, orgId)) return false;
  return (
    m.role === "owner" ||
    m.role === "admin" ||
    m.role === "receiver" ||
    m.role === "buyer"
  );
}

/** A supplier membership only ever refers to its own supplier id. */
export function canAccessSupplier(
  m: Membership,
  supplierId: SupplierProfile["id"],
): boolean {
  return isSupplierSide(m) && m.supplierId === supplierId;
}

/** Catalog edits require owner/admin/catalog_operator on that supplier. */
export function canEditSupplierCatalog(
  m: Membership,
  supplierId: SupplierProfile["id"],
): boolean {
  if (!canAccessSupplier(m, supplierId)) return false;
  return m.role === "owner" || m.role === "admin" || m.role === "catalog_operator";
}

/** Responding to suborders requires owner/admin/order_operator on that supplier. */
export function canRespondToSuborder(
  m: Membership,
  supplierId: SupplierProfile["id"],
): boolean {
  if (!canAccessSupplier(m, supplierId)) return false;
  return m.role === "owner" || m.role === "admin" || m.role === "order_operator";
}

/**
 * The single gate for reading a suborder. Both the owning buyer org and the
 * specific supplier may read it. A different supplier NEVER can.
 */
export function canViewSuborder(
  m: Membership,
  suborder: SupplierSuborder,
  location: BuyerLocation | undefined,
): boolean {
  if (isBuyerSide(m)) {
    return m.orgId === suborder.orgId && location?.orgId === suborder.orgId;
  }
  if (isSupplierSide(m)) {
    return m.supplierId === suborder.supplierId;
  }
  // Operator side: read-only support access is granted by the operator view,
  // which itself only shows synthetic demo queues.
  return false;
}

/** Operator read-only access is scoped and never grants editing of terms. */
export function canModerateContent(m: Membership): boolean {
  return isPlatformSide(m) && (m.role === "moderator" || m.role === "support");
}

/**
 * Who may cancel a suborder branch, and only that branch.
 *
 * - The owning buyer org (owner/admin/buyer) may cancel any branch it owns.
 * - The exact supplier of the branch (owner/admin/order_operator) may cancel
 *   its OWN branch (e.g. it can no longer fulfil), never a sibling's.
 * - A foreign supplier, a viewer/receiver, or a platform operator may NOT.
 *
 * Cancellation never applies to a terminal branch; the caller checks the
 * state-machine transition separately so the reason stays precise.
 */
export function canCancelSuborder(m: Membership, suborder: SupplierSuborder): boolean {
  if (isBuyerSide(m)) {
    return m.orgId === suborder.orgId && canManageProcurement(m, suborder.orgId);
  }
  if (isSupplierSide(m)) {
    return (
      m.supplierId === suborder.supplierId && canRespondToSuborder(m, suborder.supplierId)
    );
  }
  return false;
}

/**
 * Operators must never change price/order terms on behalf of a party. Provided
 * as an explicit deny so a future feature cannot accidentally enable it.
 */
export function operatorCanEditOrderTerms(): false {
  return false;
}

/** Filter a supplier's suborders down to only those it may see. */
export function visibleSubordersForSupplier(
  m: Membership,
  suborders: readonly SupplierSuborder[],
): readonly SupplierSuborder[] {
  if (!isSupplierSide(m) || m.supplierId === null) return [];
  return suborders.filter((s) => s.supplierId === m.supplierId);
}

/** Filter suborders visible to a buyer org (must also match the location's org). */
export function visibleSubordersForBuyer(
  m: Membership,
  suborders: readonly SupplierSuborder[],
  locationsById: ReadonlyMap<string, BuyerLocation>,
): readonly SupplierSuborder[] {
  if (!isBuyerSide(m)) return [];
  return suborders.filter((s) => {
    if (s.orgId !== m.orgId) return false;
    const loc = locationsById.get(s.locationId);
    return loc?.orgId === m.orgId;
  });
}

/**
 * Single combined visibility filter. Buyers see their own org's suborders
 * (matched by location); suppliers see only their own branch; platform operators
 * are not granted suborder access here.
 */
export function visibleSuborders(
  m: Membership,
  suborders: readonly SupplierSuborder[],
  locationsById: ReadonlyMap<string, BuyerLocation>,
): readonly SupplierSuborder[] {
  if (isBuyerSide(m)) return visibleSubordersForBuyer(m, suborders, locationsById);
  if (isSupplierSide(m)) return visibleSubordersForSupplier(m, suborders);
  return [];
}

/**
 * Can this membership read a parent procurement? A buyer org may read its own;
 * a supplier may read a parent only if it has at least one suborder inside it.
 */
export function canViewParentProcurement(
  m: Membership,
  parent: { orgId: Organization["id"] },
  subordersInParent: readonly SupplierSuborder[],
  locationsById: ReadonlyMap<string, BuyerLocation>,
): boolean {
  if (isBuyerSide(m)) {
    return (
      canAccessBuyerOrg(m, parent.orgId) &&
      visibleSubordersForBuyer(m, subordersInParent, locationsById).length > 0
    );
  }
  if (isSupplierSide(m)) {
    return visibleSubordersForSupplier(m, subordersInParent).length > 0;
  }
  return false;
}
