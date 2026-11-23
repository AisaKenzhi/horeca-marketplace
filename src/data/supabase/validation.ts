import type { CatalogOfferDraft, BuyerLocationDraft } from "./workspace";

export function validateOrganizationName(name: string): string | null {
  const normalized = name.trim();
  if (normalized.length < 2 || normalized.length > 120) {
    return "Название организации должно содержать от 2 до 120 символов.";
  }
  return null;
}

export function validateBuyerLocation(input: BuyerLocationDraft): string | null {
  if (input.name.trim().length < 1 || input.name.trim().length > 120) {
    return "Название точки должно содержать от 1 до 120 символов.";
  }
  if (input.address.trim().length < 1 || input.address.trim().length > 500) {
    return "Адрес должен содержать от 1 до 500 символов.";
  }
  if ((input.deliveryZone?.trim().length ?? 0) > 120) {
    return "Зона доставки не должна превышать 120 символов.";
  }
  return null;
}

function positiveInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export function validateCatalogOffer(input: CatalogOfferDraft): string | null {
  if (input.supplierSku.trim().length < 1 || input.supplierSku.trim().length > 80) {
    return "SKU должен содержать от 1 до 80 символов.";
  }
  if (input.title.trim().length < 1 || input.title.trim().length > 180) {
    return "Название товара должно содержать от 1 до 180 символов.";
  }
  if (input.category.trim().length < 1 || input.category.trim().length > 80) {
    return "Категория должна содержать от 1 до 80 символов.";
  }
  if (input.sellUnitLabel.trim().length < 1 || input.sellUnitLabel.trim().length > 120) {
    return "Обозначьте продаваемую единицу (до 120 символов).";
  }
  if (!positiveInteger(input.unitsPerSellUnit)) {
    return "Количество единиц в продаваемой упаковке должно быть целым числом больше нуля.";
  }
  if (
    !Number.isFinite(input.packAmount) ||
    input.packAmount <= 0 ||
    input.packAmount > 999_999_999.999
  ) {
    return "Количество в упаковке должно быть больше нуля и не превышать допустимый диапазон.";
  }
  if (input.priceAmount !== null) {
    if (
      !Number.isFinite(input.priceAmount) ||
      input.priceAmount <= 0 ||
      input.priceAmount > 999_999_999_999.9999
    ) {
      return "Цена должна быть больше нуля и не превышать допустимый диапазон.";
    }
    if (!/^[A-Z]{3}$/.test(input.currency ?? "")) {
      return "Для цены укажите трёхбуквенный код валюты латиницей, например EUR.";
    }
  } else if (input.currency !== null) {
    return "Код валюты можно указать только вместе с ценой.";
  }
  if (!positiveInteger(input.moq)) {
    return "Минимальное количество заказа должно быть целым числом больше нуля.";
  }
  if (!positiveInteger(input.orderStep)) {
    return "Шаг заказа должен быть целым числом больше нуля.";
  }
  return null;
}
