/**
 * Synthetic demo seed.
 *
 * ALL data here is fictional: fake organisations, people, cities, prices and
 * products. It exists only so the P0 prototype has something to render. No real
 * supplier, buyer, address, price or document is represented. Nothing here is
 * created by contacting anyone.
 *
 * Timestamps are generated relative to a fixed "demo now" so the freshness
 * states are stable and reviewable.
 */

import type {
  Basket,
  BuyerList,
  BuyerLocation,
  Membership,
  Organization,
  Product,
  SupplierOffer,
  SupplierProfile,
} from "@/domain/entities";
import {
  asBasketId,
  asBuyerListId,
  asBuyerLocationId,
  asIso,
  asMembershipId,
  asOfferId,
  asOrgId,
  asProductId,
  asSupplierId,
  asUserId,
} from "@/domain/ids";
import { money } from "@/domain/money";

/** The fixed reference instant for the demo (UTC). */
export const DEMO_NOW = "2026-11-19T12:00:00.000Z";

const hoursAgo = (h: number): string =>
  new Date(Date.parse(DEMO_NOW) - h * 3_600_000).toISOString();

/* --------------------------- Organizations ---------------------------- */

export const organizations: readonly Organization[] = [
  { id: asOrgId("org-demo-cafe"), name: "Демо-кафе «Тулпар»", isDemo: true },
  { id: asOrgId("org-demo-hotel"), name: "Демо-отель «Степь»", isDemo: true },
  { id: asOrgId("org-sup-alpha"), name: "Поставщик «Альфа» (демо)", isDemo: true },
  { id: asOrgId("org-sup-beta"), name: "Поставщик «Бета» (демо)", isDemo: true },
  { id: asOrgId("org-sup-gamma"), name: "Поставщик «Гамма» (демо)", isDemo: true },
  { id: asOrgId("org-platform"), name: "Платформа (демо)", isDemo: true },
];

export const buyerLocations: readonly BuyerLocation[] = [
  {
    id: asBuyerLocationId("loc-cafe-1"),
    orgId: asOrgId("org-demo-cafe"),
    name: "Демо-точка на Абая",
    addressDemo: "Демо-адрес, ул. Примерная 1 (не настоящий)",
    deliveryZone: "almaty-center",
  },
  {
    id: asBuyerLocationId("loc-cafe-2"),
    orgId: asOrgId("org-demo-cafe"),
    name: "Демо-точка на Саина",
    addressDemo: "Демо-адрес, ул. Примерная 2 (не настоящий)",
    deliveryZone: "almaty-north",
  },
  {
    id: asBuyerLocationId("loc-hotel-1"),
    orgId: asOrgId("org-demo-hotel"),
    name: "Демо-кухня отеля",
    addressDemo: "Демо-адрес, пр. Примерный 3 (не настоящий)",
    deliveryZone: "almaty-center",
  },
];

/* --------------------------- Suppliers -------------------------------- */

export const suppliers: readonly SupplierProfile[] = [
  {
    id: asSupplierId("sup-alpha"),
    orgId: asOrgId("org-sup-alpha"),
    displayName: "Поставщик «Альфа» (демо)",
    coverageDemo: "Демо-город",
    deliveryZones: ["almaty-center", "almaty-north"],
    minimumOrderValue: money(15_000),
    freeDeliveryThreshold: money(50_000),
    deliveryFee: money(2_500),
    deliveryDaysDemo: ["Пн", "Ср", "Пт"],
    deliveryWindowsDemo: ["09:00–13:00"],
    storefrontState: "draft_demo",
  },
  {
    id: asSupplierId("sup-beta"),
    orgId: asOrgId("org-sup-beta"),
    displayName: "Поставщик «Бета» (демо)",
    coverageDemo: "Демо-город",
    deliveryZones: ["almaty-center"],
    minimumOrderValue: money(10_000),
    freeDeliveryThreshold: null,
    // Delivery fee genuinely unknown for this supplier.
    deliveryFee: null,
    deliveryDaysDemo: ["Вт", "Чт"],
    deliveryWindowsDemo: ["14:00–18:00"],
    storefrontState: "draft_demo",
  },
  {
    id: asSupplierId("sup-gamma"),
    orgId: asOrgId("org-sup-gamma"),
    displayName: "Поставщик «Гамма» (демо)",
    coverageDemo: "Демо-город",
    deliveryZones: ["almaty-north"],
    minimumOrderValue: money(8_000),
    freeDeliveryThreshold: money(30_000),
    deliveryFee: money(1_800),
    deliveryDaysDemo: ["Сб"],
    deliveryWindowsDemo: ["10:00–12:00"],
    storefrontState: "draft_demo",
  },
];

import type { NotificationEvent } from "@/domain/entities";

/* ----------------------------- Products ------------------------------- */

export const products: readonly Product[] = [
  {
    id: asProductId("prod-flour"),
    name: "Мука пшеничная высшего сорта (демо)",
    category: "Бакалея",
    brandDemo: "Бренд-пример",
    manufacturerDemo: "Демо-мелькомбинат",
    countryOfOriginDemo: "Казахстан (демо)",
  },
  {
    id: asProductId("prod-sugar"),
    name: "Сахар-песок (демо)",
    category: "Бакалея",
    brandDemo: null,
    manufacturerDemo: null,
    countryOfOriginDemo: null,
  },
  {
    id: asProductId("prod-oil"),
    name: "Масло подсолнечное рафинированное (демо)",
    category: "Масла",
    brandDemo: "Бренд-пример",
    manufacturerDemo: null,
    countryOfOriginDemo: "Казахстан (демо)",
  },
  {
    id: asProductId("prod-rice"),
    name: "Рис длиннозёрный (демо)",
    category: "Бакалея",
    brandDemo: null,
    manufacturerDemo: null,
    countryOfOriginDemo: null,
  },
  {
    id: asProductId("prod-tomato"),
    name: "Томатная паста 28% (демо)",
    category: "Консервация",
    brandDemo: null,
    manufacturerDemo: "Демо-консервный завод",
    countryOfOriginDemo: "Казахстан (демо)",
  },
  {
    id: asProductId("prod-beef"),
    name: "Говядина охлаждённая, лопатка (демо)",
    category: "Мясо",
    brandDemo: null,
    manufacturerDemo: null,
    countryOfOriginDemo: null,
  },
];

/* ------------------------------ Offers -------------------------------- */

export const offers: readonly SupplierOffer[] = [
  {
    id: asOfferId("off-alpha-flour"),
    supplierId: asSupplierId("sup-alpha"),
    productId: asProductId("prod-flour"),
    supplierSku: "ALF-FLOUR-5",
    title: "Мука пшеничная в/с, мешок 5 кг (демо)",
    packaging: {
      sellUnit: {
        label: "мешок 5 кг",
        unitsPerSellUnit: 1,
        packSize: { amount: 5, baseUnit: "kg" },
      },
      moq: 2,
      orderStep: 2,
    },
    pricePerSellUnit: { value: money(3_200), observedAt: hoursAgo(1) },
    availability: { value: "in_stock", observedAt: hoursAgo(1) },
    priceValidUntil: null,
    foodInfo: {
      ingredientsDemo: "Мука пшеничная хлебопекарная в/с (демо-описание)",
      allergensDemo: ["глютен (пшеница, демо)"],
      storageDemo: "Сухое прохладное место (демо)",
      labelNotesDemo: "Демонстрационные данные, не подтверждённая маркировка",
      fieldsPresent: [
        "ingredientsDemo",
        "allergensDemo",
        "storageDemo",
        "labelNotesDemo",
      ],
    },
    archived: false,
    version: 3,
  },
  {
    id: asOfferId("off-alpha-sugar"),
    supplierId: asSupplierId("sup-alpha"),
    productId: asProductId("prod-sugar"),
    supplierSku: "ALF-SUGAR-50",
    title: "Сахар-песок, мешок 50 кг (демо, устаревшая цена)",
    packaging: {
      sellUnit: {
        label: "мешок 50 кг",
        unitsPerSellUnit: 1,
        packSize: { amount: 50, baseUnit: "kg" },
      },
      moq: 1,
      orderStep: 1,
    },
    pricePerSellUnit: { value: money(28_000), observedAt: hoursAgo(72) },
    availability: { value: "in_stock", observedAt: hoursAgo(72) },
    priceValidUntil: null,
    foodInfo: null,
    archived: false,
    version: 2,
  },
  {
    id: asOfferId("off-beta-oil"),
    supplierId: asSupplierId("sup-beta"),
    productId: asProductId("prod-oil"),
    supplierSku: "BET-OIL-1",
    title: "Масло подсолнечное, бут. 1 л (демо)",
    packaging: {
      sellUnit: {
        label: "бут. 1 л",
        unitsPerSellUnit: 1,
        packSize: { amount: 1, baseUnit: "l" },
      },
      moq: 6,
      orderStep: 6,
    },
    pricePerSellUnit: { value: money(900), observedAt: hoursAgo(2) },
    availability: { value: "low_stock", observedAt: hoursAgo(2) },
    priceValidUntil: null,
    foodInfo: {
      ingredientsDemo: "Масло подсолнечное рафинированное (демо-описание)",
      allergensDemo: [],
      storageDemo: null,
      labelNotesDemo: "Демонстрационные данные",
      fieldsPresent: ["ingredientsDemo", "labelNotesDemo"],
    },
    archived: false,
    version: 1,
  },
  {
    id: asOfferId("off-beta-tomato"),
    supplierId: asSupplierId("sup-beta"),
    productId: asProductId("prod-tomato"),
    supplierSku: "BET-TOM-28",
    title: "Томатная паста 28%, банка 1 кг (демо, цена не указана)",
    packaging: {
      sellUnit: {
        label: "банка 1 кг",
        unitsPerSellUnit: 1,
        packSize: { amount: 1, baseUnit: "kg" },
      },
      moq: 12,
      orderStep: 12,
    },
    pricePerSellUnit: { value: null, observedAt: null },
    availability: { value: null, observedAt: null },
    priceValidUntil: null,
    foodInfo: null,
    archived: false,
    version: 1,
  },
  {
    id: asOfferId("off-gamma-rice"),
    supplierId: asSupplierId("sup-gamma"),
    productId: asProductId("prod-rice"),
    supplierSku: "GAM-RICE-10",
    title: "Рис длиннозёрный, мешок 10 кг (демо)",
    packaging: {
      sellUnit: {
        label: "мешок 10 кг",
        unitsPerSellUnit: 1,
        packSize: { amount: 10, baseUnit: "kg" },
      },
      moq: 1,
      orderStep: 1,
    },
    pricePerSellUnit: { value: money(7_500), observedAt: hoursAgo(5) },
    availability: { value: "on_request", observedAt: hoursAgo(5) },
    priceValidUntil: null,
    foodInfo: null,
    archived: false,
    version: 1,
  },
  {
    id: asOfferId("off-gamma-beef"),
    supplierId: asSupplierId("sup-gamma"),
    productId: asProductId("prod-beef"),
    supplierSku: "GAM-BEEF-1",
    title: "Говядина охлаждённая, лопатка, 1 кг (демо)",
    packaging: {
      sellUnit: {
        label: "кг",
        unitsPerSellUnit: 1,
        packSize: { amount: 1, baseUnit: "kg" },
      },
      moq: 5,
      orderStep: 1,
    },
    // Long-lived could be a food case; kept only as an anonymous demo example.
    pricePerSellUnit: { value: money(2_800), observedAt: hoursAgo(30) },
    availability: { value: "in_stock", observedAt: hoursAgo(30) },
    priceValidUntil: hoursAgo(-48),
    foodInfo: {
      ingredientsDemo: null,
      allergensDemo: [],
      storageDemo: "Холодильник 0…+4 °C (демо)",
      labelNotesDemo:
        "Демонстрационные данные; не подтверждает качество или соответствие",
      fieldsPresent: ["storageDemo", "labelNotesDemo"],
    },
    archived: false,
    version: 4,
  },
  {
    id: asOfferId("off-alpha-archived"),
    supplierId: asSupplierId("sup-alpha"),
    productId: asProductId("prod-flour"),
    supplierSku: "ALF-FLOUR-25-OLD",
    title: "Мука пшеничная, мешок 25 кг (демо, снято с продажи)",
    packaging: {
      sellUnit: {
        label: "мешок 25 кг",
        unitsPerSellUnit: 1,
        packSize: { amount: 25, baseUnit: "kg" },
      },
      moq: 1,
      orderStep: 1,
    },
    pricePerSellUnit: { value: money(15_000), observedAt: hoursAgo(200) },
    availability: { value: "out_of_stock", observedAt: hoursAgo(200) },
    priceValidUntil: null,
    foodInfo: null,
    archived: true,
    version: 5,
  },
];

/* --------------------- Demo memberships (personas) --------------------- */
/*
 * These are DEMO personas for switching roles in the prototype. They are NOT
 * real accounts and NOT real authentication.
 */

export const memberships: readonly Membership[] = [
  {
    id: asMembershipId("mem-buyer-owner"),
    userId: asUserId("user-buyer-owner"),
    orgId: asOrgId("org-demo-cafe"),
    supplierId: null,
    side: "buyer",
    role: "owner",
    displayName: "Айдос — владелец кафе (демо)",
    isDemo: true,
  },
  {
    id: asMembershipId("mem-buyer-purchaser"),
    userId: asUserId("user-buyer-purchaser"),
    orgId: asOrgId("org-demo-cafe"),
    supplierId: null,
    side: "buyer",
    role: "buyer",
    displayName: "Мадина — закупщик (демо)",
    isDemo: true,
  },
  {
    id: asMembershipId("mem-buyer-receiver"),
    userId: asUserId("user-buyer-receiver"),
    orgId: asOrgId("org-demo-cafe"),
    supplierId: null,
    side: "buyer",
    role: "receiver",
    displayName: "Ерлан — приёмщик (демо)",
    isDemo: true,
  },
  {
    id: asMembershipId("mem-buyer-viewer"),
    userId: asUserId("user-buyer-viewer"),
    orgId: asOrgId("org-demo-cafe"),
    supplierId: null,
    side: "buyer",
    role: "viewer",
    displayName: "Наблюдатель (демо)",
    isDemo: true,
  },
  {
    id: asMembershipId("mem-buyer-hotel"),
    userId: asUserId("user-buyer-hotel"),
    orgId: asOrgId("org-demo-hotel"),
    supplierId: null,
    side: "buyer",
    role: "owner",
    displayName: "Отель «Степь» — владелец (демо)",
    isDemo: true,
  },
  {
    id: asMembershipId("mem-sup-alpha-owner"),
    userId: asUserId("user-sup-alpha-owner"),
    orgId: asOrgId("org-sup-alpha"),
    supplierId: asSupplierId("sup-alpha"),
    side: "supplier",
    role: "owner",
    displayName: "Альфа — владелец витрины (демо)",
    isDemo: true,
  },
  {
    id: asMembershipId("mem-sup-alpha-cat"),
    userId: asUserId("user-sup-alpha-cat"),
    orgId: asOrgId("org-sup-alpha"),
    supplierId: asSupplierId("sup-alpha"),
    side: "supplier",
    role: "catalog_operator",
    displayName: "Альфа — оператор каталога (демо)",
    isDemo: true,
  },
  {
    id: asMembershipId("mem-sup-alpha-ord"),
    userId: asUserId("user-sup-alpha-ord"),
    orgId: asOrgId("org-sup-alpha"),
    supplierId: asSupplierId("sup-alpha"),
    side: "supplier",
    role: "order_operator",
    displayName: "Альфа — оператор заказов (демо)",
    isDemo: true,
  },
  {
    id: asMembershipId("mem-sup-beta-owner"),
    userId: asUserId("user-sup-beta-owner"),
    orgId: asOrgId("org-sup-beta"),
    supplierId: asSupplierId("sup-beta"),
    side: "supplier",
    role: "owner",
    displayName: "Бета — владелец витрины (демо)",
    isDemo: true,
  },
  {
    id: asMembershipId("mem-platform-mod"),
    userId: asUserId("user-platform-mod"),
    orgId: asOrgId("org-platform"),
    supplierId: null,
    side: "platform",
    role: "moderator",
    displayName: "Модератор платформы (демо)",
    isDemo: true,
  },
  {
    id: asMembershipId("mem-platform-support"),
    userId: asUserId("user-platform-support"),
    orgId: asOrgId("org-platform"),
    supplierId: null,
    side: "platform",
    role: "support",
    displayName: "Поддержка платформы (демо)",
    isDemo: true,
  },
];

/* ---------------------------- Buyer lists ------------------------------ */

export const buyerLists: readonly BuyerList[] = [
  {
    id: asBuyerListId("list-cafe-weekly"),
    orgId: asOrgId("org-demo-cafe"),
    name: "Демо-закупка на неделю",
    offerIds: [asOfferId("off-alpha-flour"), asOfferId("off-beta-oil")],
  },
];

/* ----------------------------- Basket ---------------------------------- */

export const basket: Basket = {
  id: asBasketId("basket-cafe-1"),
  orgId: asOrgId("org-demo-cafe"),
  locationId: asBuyerLocationId("loc-cafe-1"),
  lines: [
    {
      id: "bl-1" as Basket["lines"][number]["id"],
      offerId: asOfferId("off-alpha-flour"),
      supplierId: asSupplierId("sup-alpha"),
      // 6 x 3 200 = 19 200 >= Alpha minimum of 15 000 (demo default is submittable).
      quantity: 6,
      addedAtPriceSnapshot: money(3_200),
      addedAt: asIso(hoursAgo(1)),
    },
    {
      id: "bl-2" as Basket["lines"][number]["id"],
      offerId: asOfferId("off-beta-oil"),
      supplierId: asSupplierId("sup-beta"),
      // 12 x 900 = 10 800 >= Beta minimum of 10 000.
      quantity: 12,
      addedAtPriceSnapshot: money(900),
      addedAt: asIso(hoursAgo(2)),
    },
  ],
};

/* ------------------------ Demo notifications --------------------------- */

export const notifications: readonly NotificationEvent[] = [
  {
    id: "notif-1" as NotificationEvent["id"],
    channel: "inbox",
    audienceUserId: asUserId("user-buyer-purchaser"),
    titleDemo: "Демонстрационное уведомление",
    bodyDemo: "Это локальное демо-уведомление. Ничего наружу не отправлялось.",
    createdAt: asIso(hoursAgo(1)),
    read: false,
    dedupKey: "demo-welcome-1",
  },
];
