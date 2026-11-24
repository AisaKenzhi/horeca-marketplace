import {
  describeAvailability,
  evaluateFreshness,
  type AvailabilityStatus,
  type FreshnessState,
} from "./freshness";
import { checkOrderQuantity } from "./packaging";

export interface DraftCartItemInput {
  readonly id: string;
  readonly catalog_offer_id: string;
  readonly quantity: number;
  readonly catalog_offer_version: number;
}

export interface DraftCartInput {
  readonly id: string;
  readonly organization_id: string;
  readonly buyer_location_id: string | null;
  readonly items: readonly DraftCartItemInput[];
}

export interface DraftCartLocationInput {
  readonly id: string;
  readonly organization_id: string;
  readonly name: string;
  readonly delivery_zone?: string | null;
}

export interface DraftCartOfferInput {
  readonly id: string;
  readonly supplier_organization_id: string;
  readonly title: string;
  readonly sell_unit_label: string;
  readonly price_amount: number | null;
  readonly currency: string | null;
  readonly moq: number;
  readonly order_step: number;
  readonly availability:
    "in_stock" | "low_stock" | "out_of_stock" | "on_request" | "unknown";
  readonly price_valid_until: string | null;
  readonly is_published: boolean;
  readonly price_observed_at: string | null;
  readonly availability_observed_at: string | null;
  readonly version: number;
}

export interface DraftCartSupplierInput {
  readonly organization_id: string;
  readonly display_name: string;
  readonly verification_status: "pending" | "approved" | "rejected";
}

export interface DraftCartLineReview {
  readonly itemId: string;
  readonly title: string;
  readonly supplierName: string;
  readonly quantity: number;
  readonly sellUnitLabel: string | null;
  readonly snapshotVersion: number;
  readonly currentVersion: number | null;
  readonly priceLabel: string | null;
  readonly priceCurrency: string | null;
  readonly priceFreshness: FreshnessState | "not_available";
  readonly availabilityLabel: string;
  readonly availabilityFreshness: FreshnessState | "not_available";
  readonly issues: readonly string[];
  readonly subtotalMinor: bigint | null;
}

export interface DraftCartSupplierReview {
  readonly key: string;
  readonly supplierName: string;
  readonly lines: readonly DraftCartLineReview[];
  readonly blockers: readonly string[];
  readonly subtotalCurrency: string | null;
  readonly subtotalMinor: bigint | null;
  readonly subtotalNote: string | null;
}

export interface DraftCartReadinessReview {
  readonly cartId: string;
  readonly scopeMismatch: boolean;
  readonly locationName: string | null;
  readonly locationIssues: readonly string[];
  readonly supplierGroups: readonly DraftCartSupplierReview[];
  readonly blockers: readonly string[];
  readonly readyForCurrentChecks: boolean;
  readonly coverageWarning: string;
}

function currencyDigits(currency: string): number | null {
  try {
    const digits = new Intl.NumberFormat("ru-RU", {
      style: "currency",
      currency,
    }).resolvedOptions().maximumFractionDigits;
    return typeof digits === "number" ? digits : null;
  } catch {
    return null;
  }
}

function expandNumber(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null;
  const raw = value.toString().toLowerCase();
  const [mantissa, exponentText] = raw.split("e");
  if (mantissa === undefined) return null;
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  if (!Number.isInteger(exponent)) return null;
  const [integerPart = "0", fractionalPart = ""] = mantissa.split(".");
  const digits = `${integerPart}${fractionalPart}`;
  const decimalPosition = integerPart.length + exponent;
  if (decimalPosition <= 0) return `0.${"0".repeat(-decimalPosition)}${digits}`;
  if (decimalPosition >= digits.length)
    return `${digits}${"0".repeat(decimalPosition - digits.length)}`;
  return `${digits.slice(0, decimalPosition)}.${digits.slice(decimalPosition)}`;
}

function amountToMinorUnits(amount: number, digits: number): bigint | null {
  const expanded = expandNumber(amount);
  if (expanded === null) return null;
  const [integerPart = "0", fractionPart = ""] = expanded.split(".");
  if (fractionPart.slice(digits).replace(/0/g, "").length > 0) return null;
  const fraction = fractionPart.slice(0, digits).padEnd(digits, "0");
  try {
    const scale = 10n ** BigInt(digits);
    return BigInt(integerPart) * scale + BigInt(fraction || "0");
  } catch {
    return null;
  }
}

export function formatCurrencyAmount(
  amount: number,
  currencyInput: string,
  locale = "ru-RU",
): string | null {
  const currency = currencyInput.trim().toUpperCase();
  const digits = currencyDigits(currency);
  if (digits === null) return null;
  const minor = amountToMinorUnits(amount, digits);
  if (minor === null) return null;
  return formatMinorUnits(minor, currency, digits, locale);
}

export function formatCurrencyMinor(
  amountMinor: bigint,
  currency: string,
  locale = "ru-RU",
): string {
  const digits = currencyDigits(currency);
  if (digits === null) return `${amountMinor.toString()} ${currency}`;
  return formatMinorUnits(amountMinor, currency, digits, locale);
}

function formatMinorUnits(
  amountMinor: bigint,
  currency: string,
  digits: number,
  locale: string,
): string {
  const sign = amountMinor < 0n ? -1n : 1n;
  const absolute = amountMinor * sign;
  const scale = 10n ** BigInt(digits);
  const whole = absolute / scale;
  const fraction = (absolute % scale).toString().padStart(digits, "0");
  const wholeLabel = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
    useGrouping: true,
  }).format(whole);
  const template = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).formatToParts(amountMinor < 0n ? -1 : 0);
  let integerUsed = false;
  return template
    .map((part) => {
      if (part.type === "integer") {
        if (integerUsed) return "";
        integerUsed = true;
        return wholeLabel;
      }
      if (part.type === "group") return "";
      if (part.type === "fraction") return fraction;
      if (part.type === "decimal" && digits === 0) return "";
      return part.value;
    })
    .join("");
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function currentPriceExpiryIssue(
  priceValidUntil: string | null,
  nowIso: string,
): string | null {
  if (priceValidUntil === null) return null;
  const expiresAt = Date.parse(priceValidUntil);
  const now = Date.parse(nowIso);
  if (!Number.isFinite(expiresAt) || !Number.isFinite(now)) {
    return "Срок действия цены не удалось проверить.";
  }
  return expiresAt <= now ? "Срок действия цены истёк; нужна новая цена." : null;
}

function createUnavailableLine(item: DraftCartItemInput): DraftCartLineReview {
  return {
    itemId: item.id,
    title: "Предложение сейчас недоступно",
    supplierName: "Поставщик не установлен",
    quantity: item.quantity,
    sellUnitLabel: null,
    snapshotVersion: item.catalog_offer_version,
    currentVersion: null,
    priceLabel: null,
    priceCurrency: null,
    priceFreshness: "not_available",
    availabilityLabel: "наличие не указано",
    availabilityFreshness: "not_available",
    issues: [
      "Предложение больше недоступно в каталоге; выберите актуальное предложение или удалите позицию.",
    ],
    subtotalMinor: null,
  };
}

function reviewLine(
  item: DraftCartItemInput,
  offer: DraftCartOfferInput | undefined,
  supplier: DraftCartSupplierInput | undefined,
  nowIso: string,
): DraftCartLineReview {
  if (!offer) return createUnavailableLine(item);

  const issues: string[] = [];
  if (!offer.is_published) issues.push("Предложение снято с публикации.");
  if (supplier?.verification_status !== "approved") {
    issues.push("Статус одобрения поставщика не подтверждён.");
  }

  const quantityCheck = checkOrderQuantity(item.quantity, {
    sellUnit: {
      label: offer.sell_unit_label,
      unitsPerSellUnit: 1,
      packSize: { amount: 1, baseUnit: "piece" },
    },
    moq: offer.moq,
    orderStep: offer.order_step,
  });
  if (!quantityCheck.ok) issues.push(quantityCheck.message);

  const versionMatches = offer.version === item.catalog_offer_version;
  if (!versionMatches) {
    issues.push(
      `Версия предложения изменилась: в корзине ${item.catalog_offer_version}, сейчас ${offer.version}; цену и условия нужно проверить заново.`,
    );
  }

  let priceFreshness: FreshnessState | "not_available" = "unknown";
  let priceCurrency: string | null = null;
  let priceLabel: string | null = null;
  let priceMinor: bigint | null = null;
  let priceCurrent = false;
  if (offer.price_amount === null) {
    priceFreshness = "not_available";
    issues.push("Цена не указана в предложении.");
  } else {
    const freshness = evaluateFreshness(
      { value: offer.price_amount, observedAt: offer.price_observed_at },
      nowIso,
    );
    priceFreshness = freshness.state;
    if (freshness.state === "stale") {
      issues.push("Цена наблюдалась более 24 часов назад; нужна актуализация.");
    } else if (freshness.state === "unknown") {
      issues.push("Свежесть цены не удалось проверить.");
    }
    const normalizedCurrency = offer.currency?.trim().toUpperCase() ?? "";
    if (!normalizedCurrency) {
      issues.push("Валюта цены не указана.");
    } else {
      priceLabel = formatCurrencyAmount(offer.price_amount, normalizedCurrency);
      if (priceLabel === null) {
        issues.push("Цена или валюта не распознана; подытог не рассчитывается.");
      } else {
        priceCurrency = normalizedCurrency;
        const digits = currencyDigits(normalizedCurrency);
        priceMinor =
          digits === null ? null : amountToMinorUnits(offer.price_amount, digits);
      }
    }
    const expiryIssue = currentPriceExpiryIssue(offer.price_valid_until, nowIso);
    if (expiryIssue) issues.push(expiryIssue);
    priceCurrent =
      freshness.state === "fresh" &&
      expiryIssue === null &&
      versionMatches &&
      offer.is_published &&
      supplier?.verification_status === "approved" &&
      priceMinor !== null &&
      priceCurrency !== null;
  }

  const availabilityValue: AvailabilityStatus | null =
    offer.availability === "unknown" ? null : offer.availability;
  const availabilityFreshness = evaluateFreshness(
    { value: availabilityValue, observedAt: offer.availability_observed_at },
    nowIso,
  );
  const availabilityLabel = describeAvailability({
    value: availabilityValue,
    observedAt: offer.availability_observed_at,
  });
  if (availabilityValue === null) {
    issues.push("Наличие не указано и не считается подтверждённым.");
  } else {
    if (availabilityFreshness.state === "stale") {
      issues.push("Наблюдение о наличии старше 24 часов; наличие нужно уточнить.");
    } else if (availabilityFreshness.state === "unknown") {
      issues.push("Свежесть сведений о наличии не удалось проверить.");
    }
    if (availabilityValue !== "in_stock") {
      issues.push(
        `Доступность «${availabilityLabel}» не подтверждает достаточное количество; требуется уточнение.`,
      );
    }
  }

  const subtotalMinor =
    priceCurrent && priceMinor !== null && quantityCheck.ok
      ? priceMinor * BigInt(quantityCheck.quantity)
      : null;
  return {
    itemId: item.id,
    title: offer.title,
    supplierName: supplier?.display_name ?? "Поставщик не проверен",
    quantity: item.quantity,
    sellUnitLabel: offer.sell_unit_label,
    snapshotVersion: item.catalog_offer_version,
    currentVersion: offer.version,
    priceLabel,
    priceCurrency,
    priceFreshness,
    availabilityLabel,
    availabilityFreshness: availabilityFreshness.state,
    issues: unique(issues),
    subtotalMinor,
  };
}

export function reviewDraftCart(input: {
  readonly organizationId: string;
  readonly cart: DraftCartInput;
  readonly locations: readonly DraftCartLocationInput[];
  readonly offers: readonly DraftCartOfferInput[];
  readonly suppliers: readonly DraftCartSupplierInput[];
  readonly nowIso: string;
}): DraftCartReadinessReview {
  const { organizationId, cart } = input;
  const coverageWarning =
    "Зоны доставки поставщиков и тарифы не хранятся в этой версии. Выбранная точка принадлежит вашей организации, но покрытие и доставка не подтверждены.";
  if (cart.organization_id !== organizationId) {
    return {
      cartId: cart.id,
      scopeMismatch: true,
      locationName: null,
      locationIssues: [],
      supplierGroups: [],
      blockers: ["Черновая корзина недоступна в этой организации."],
      readyForCurrentChecks: false,
      coverageWarning,
    };
  }

  const location = cart.buyer_location_id
    ? input.locations.find(
        (candidate) =>
          candidate.id === cart.buyer_location_id &&
          candidate.organization_id === organizationId,
      )
    : undefined;
  const locationIssues = location
    ? []
    : [
        cart.buyer_location_id
          ? "Выбранная точка не найдена среди точек этой организации."
          : "Выберите точку покупателя для этой черновой корзины.",
      ];

  const offersById = new Map(input.offers.map((offer) => [offer.id, offer]));
  const suppliersById = new Map(
    input.suppliers.map((supplier) => [supplier.organization_id, supplier]),
  );
  const groups = new Map<
    string,
    { supplierName: string; lines: DraftCartLineReview[] }
  >();

  for (const item of cart.items) {
    const offer = offersById.get(item.catalog_offer_id);
    const supplier = offer
      ? suppliersById.get(offer.supplier_organization_id)
      : undefined;
    const line = reviewLine(item, offer, supplier, input.nowIso);
    const key = offer
      ? `supplier:${offer.supplier_organization_id}`
      : `unavailable:${item.id}`;
    const group = groups.get(key) ?? {
      supplierName: offer
        ? (supplier?.display_name ?? "Поставщик не проверен")
        : "Поставщик не установлен",
      lines: [],
    };
    group.lines.push(line);
    groups.set(key, group);
  }

  const supplierGroups = [...groups.entries()].map(([key, group]) => {
    const currencies = unique(
      group.lines.flatMap((line) => (line.priceCurrency ? [line.priceCurrency] : [])),
    );
    const allPricesUsable = group.lines.every((line) => line.subtotalMinor !== null);
    const sameCurrency = currencies.length === 1;
    const subtotalMinor =
      allPricesUsable && sameCurrency
        ? group.lines.reduce((total, line) => total + (line.subtotalMinor ?? 0n), 0n)
        : null;
    let subtotalNote: string | null = null;
    if (currencies.length > 1) {
      subtotalNote =
        "В одной группе указаны разные валюты; общий подытог не рассчитывается.";
    } else if (subtotalMinor === null) {
      subtotalNote = "Подытог не рассчитан: есть непроверенная или отсутствующая цена.";
    }
    return {
      key,
      supplierName: group.supplierName,
      lines: group.lines,
      blockers: unique(group.lines.flatMap((line) => line.issues)),
      subtotalCurrency: subtotalMinor === null ? null : (currencies[0] ?? null),
      subtotalMinor,
      subtotalNote,
    };
  });

  const blockers = unique([
    ...locationIssues,
    ...(cart.items.length === 0 ? ["Черновая корзина пуста."] : []),
    ...supplierGroups.flatMap((group) => group.blockers),
  ]);
  return {
    cartId: cart.id,
    scopeMismatch: false,
    locationName: location?.name ?? null,
    locationIssues,
    supplierGroups,
    blockers,
    readyForCurrentChecks: blockers.length === 0,
    coverageWarning,
  };
}
