/**
 * Synthetic test fixtures for the P0 prototype.
 *
 * Everything here is clearly fake demo data. No real organisation, person,
 * address, price, or document is represented. Do not put real values in here.
 */

import type {
  BuyerLocation,
  Membership,
  Organization,
  SupplierOffer,
  SupplierProfile,
  SupplierSuborder,
} from "@/domain/entities";
import {
  asBasketId,
  asBuyerLocationId,
  asBasketLineId,
  asIso,
  asMembershipId,
  asOfferId,
  asOrgId,
  asProcurementId,
  asProductId,
  asSuborderId,
  asSupplierId,
  asUserId,
} from "@/domain/ids";
import { money } from "@/domain/money";
import type { Basket, BasketLine } from "@/domain/entities";
import type { IsoTimestamp } from "@/domain/ids";

export const NOW: IsoTimestamp = asIso("2026-11-19T12:00:00.000Z");
export const ONE_HOUR_AGO: string = "2026-11-19T11:00:00.000Z";
export const TWO_DAYS_AGO: string = "2026-11-17T12:00:00.000Z";

export const demoOrg: Organization = {
  id: asOrgId("org-demo-cafe"),
  name: "Демо-кафе «Тулпар»",
  isDemo: true,
};

export const demoLocation: BuyerLocation = {
  id: asBuyerLocationId("loc-demo-1"),
  orgId: demoOrg.id,
  name: "Демо-точка на Абая",
  addressDemo: "Демо-адрес, ул. Примерная 1",
  deliveryZone: "almaty-center",
};

export const supplierAlpha: SupplierProfile = {
  id: asSupplierId("sup-alpha"),
  orgId: asOrgId("org-sup-alpha"),
  displayName: "Поставщик «Альфа» (демо)",
  coverageDemo: "Демо",
  deliveryZones: ["almaty-center", "almaty-north"],
  minimumOrderValue: money(15_000),
  freeDeliveryThreshold: money(50_000),
  deliveryFee: money(2_500),
  deliveryDaysDemo: ["Пн", "Ср", "Пт"],
  deliveryWindowsDemo: ["09:00–13:00"],
  storefrontState: "draft_demo",
};

export const supplierBeta: SupplierProfile = {
  id: asSupplierId("sup-beta"),
  orgId: asOrgId("org-sup-beta"),
  displayName: "Поставщик «Бета» (демо)",
  coverageDemo: "Демо",
  deliveryZones: ["almaty-center"],
  minimumOrderValue: money(10_000),
  freeDeliveryThreshold: null,
  // Delivery cost genuinely unknown for this supplier.
  deliveryFee: null,
  deliveryDaysDemo: ["Вт", "Чт"],
  deliveryWindowsDemo: ["14:00–18:00"],
  storefrontState: "draft_demo",
};

export const offerAlphaFlour: SupplierOffer = {
  id: asOfferId("offer-alpha-flour"),
  supplierId: supplierAlpha.id,
  productId: asProductId("prod-flour"),
  supplierSku: "ALF-FLOUR-5",
  title: "Мука пшеничная, мешок 5 кг (демо)",
  packaging: {
    sellUnit: {
      label: "мешок 5 кг",
      unitsPerSellUnit: 1,
      packSize: { amount: 5, baseUnit: "kg" },
    },
    moq: 2,
    orderStep: 2,
  },
  pricePerSellUnit: { value: money(3_200), observedAt: ONE_HOUR_AGO },
  availability: { value: "in_stock", observedAt: ONE_HOUR_AGO },
  priceValidUntil: null,
  foodInfo: null,
  archived: false,
  version: 1,
};

export const offerAlphaStale: SupplierOffer = {
  ...offerAlphaFlour,
  id: asOfferId("offer-alpha-stale"),
  title: "Сахар, мешок 50 кг (демо, устаревшая цена)",
  supplierSku: "ALF-SUGAR-50",
  packaging: {
    sellUnit: {
      label: "мешок 50 кг",
      unitsPerSellUnit: 1,
      packSize: { amount: 50, baseUnit: "kg" },
    },
    moq: 1,
    orderStep: 1,
  },
  pricePerSellUnit: { value: money(28_000), observedAt: TWO_DAYS_AGO },
  availability: { value: "in_stock", observedAt: TWO_DAYS_AGO },
};

export const offerBetaUnknownPrice: SupplierOffer = {
  id: asOfferId("offer-beta-unknown"),
  supplierId: supplierBeta.id,
  productId: asProductId("prod-oil"),
  supplierSku: "BET-OIL-1",
  title: "Масло подсолнечное, бут. 1 л (демо, без цены)",
  packaging: {
    sellUnit: {
      label: "бут. 1 л",
      unitsPerSellUnit: 1,
      packSize: { amount: 1, baseUnit: "l" },
    },
    moq: 6,
    orderStep: 6,
  },
  pricePerSellUnit: { value: null, observedAt: null },
  availability: { value: null, observedAt: null },
  priceValidUntil: null,
  foodInfo: null,
  archived: false,
  version: 1,
};

export const offerBetaOil: SupplierOffer = {
  ...offerBetaUnknownPrice,
  id: asOfferId("offer-beta-oil"),
  title: "Масло подсолнечное, бут. 1 л (демо)",
  supplierSku: "BET-OIL-2",
  pricePerSellUnit: { value: money(900), observedAt: ONE_HOUR_AGO },
  availability: { value: "low_stock", observedAt: ONE_HOUR_AGO },
};

export const demoOffers: readonly SupplierOffer[] = [
  offerAlphaFlour,
  offerAlphaStale,
  offerBetaUnknownPrice,
  offerBetaOil,
];

export const demoSuppliers: readonly SupplierProfile[] = [supplierAlpha, supplierBeta];

export function makeBasketLine(
  id: string,
  offer: SupplierOffer,
  quantity: number,
): BasketLine {
  return {
    id: asBasketLineId(id),
    offerId: offer.id,
    supplierId: offer.supplierId,
    quantity,
    addedAtPriceSnapshot: offer.pricePerSellUnit.value,
    addedAt: asIso(NOW),
  };
}

export function makeBasket(lines: readonly BasketLine[]): Basket {
  return {
    id: asBasketId("basket-demo"),
    orgId: demoOrg.id,
    locationId: demoLocation.id,
    lines,
  };
}

export const buyerOwner: Membership = {
  id: asMembershipId("mem-buyer-owner"),
  userId: asUserId("user-buyer-owner"),
  orgId: demoOrg.id,
  supplierId: null,
  side: "buyer",
  role: "owner",
  displayName: "Владелец (демо)",
  isDemo: true,
};

export const buyerViewer: Membership = {
  ...buyerOwner,
  id: asMembershipId("mem-buyer-viewer"),
  userId: asUserId("user-buyer-viewer"),
  role: "viewer",
  displayName: "Наблюдатель (демо)",
};

export const supplierAlphaOperator: Membership = {
  id: asMembershipId("mem-sup-alpha"),
  userId: asUserId("user-sup-alpha"),
  orgId: supplierAlpha.orgId,
  supplierId: supplierAlpha.id,
  side: "supplier",
  role: "order_operator",
  displayName: "Оператор поставщика Альфа (демо)",
  isDemo: true,
};

export const supplierBetaOperator: Membership = {
  ...supplierAlphaOperator,
  id: asMembershipId("mem-sup-beta"),
  userId: asUserId("user-sup-beta"),
  orgId: supplierBeta.orgId,
  supplierId: supplierBeta.id,
  displayName: "Оператор поставщика Бета (демо)",
};

export const platformModerator: Membership = {
  id: asMembershipId("mem-platform"),
  userId: asUserId("user-platform"),
  orgId: asOrgId("org-platform"),
  supplierId: null,
  side: "platform",
  role: "moderator",
  displayName: "Модератор платформы (демо)",
  isDemo: true,
};

export function makeSuborder(
  overrides: Partial<SupplierSuborder> = {},
): SupplierSuborder {
  return {
    id: asSuborderId("sub-demo-1"),
    procurementId: asProcurementId("proc-demo-1"),
    supplierId: supplierAlpha.id,
    orgId: demoOrg.id,
    locationId: demoLocation.id,
    status: "awaiting_supplier",
    fulfillmentStatus: "not_started",
    paymentStatus: "not_processed",
    confirmedLines: null,
    currentRevisionId: `revision-sub-demo-1-1` as SupplierSuborder["currentRevisionId"],
    createdAt: asIso(NOW),
    updatedAt: asIso(NOW),
    version: 1,
    ...overrides,
  };
}
