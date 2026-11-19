/**
 * Minimal i18n scaffold.
 *
 * UI strings are not hard-coded in components. Russian is the default for the
 * demo (a reversible assumption), and Kazakh is stubbed so the structure for a
 * second locale exists. Terminology is marked as needing review, not finalised.
 */

export type Locale = "ru" | "kk";

export const LOCALES: readonly Locale[] = ["ru", "kk"];

export interface Messages {
  readonly app: {
    readonly title: string;
    readonly subtitle: string;
    readonly demoBanner: string;
  };
  readonly nav: {
    readonly catalog: string;
    readonly basket: string;
    readonly lists: string;
    readonly procurement: string;
    readonly supplier: string;
    readonly operator: string;
    readonly audit: string;
    readonly notifications: string;
  };
  readonly common: {
    readonly addToBasket: string;
    readonly addToList: string;
    readonly quantity: string;
    readonly price: string;
    readonly supplier: string;
    readonly availability: string;
    readonly updated: string;
    readonly notStated: string;
    readonly needsConfirmation: string;
    readonly moq: string;
    readonly orderStep: string;
    readonly minimumOrderValue: string;
    readonly freeDeliveryFrom: string;
    readonly deliveryFee: string;
    readonly deliveryUnknown: string;
    readonly unitPrice: string;
    readonly incomparable: string;
    readonly perSellUnit: string;
    readonly subtotal: string;
    readonly total: string;
    readonly submitDemo: string;
    readonly remove: string;
    readonly confirm: string;
    readonly reject: string;
    readonly compare: string;
    readonly loading: string;
    readonly empty: string;
    readonly error: string;
    readonly stale: string;
    readonly viewDetails: string;
    readonly back: string;
    readonly demoOnly: string;
  };
  readonly catalog: {
    readonly heading: string;
    readonly search: string;
    readonly category: string;
    readonly allCategories: string;
    readonly supplierFilter: string;
    readonly allSuppliers: string;
    readonly sortByUnitPrice: string;
  };
  readonly basket: {
    readonly heading: string;
    readonly groupBySupplierIntro: string;
    readonly noDeliveryKnown: string;
    readonly notOneBill: string;
    readonly blockers: string;
    readonly amountToMinimumPrefix: string;
    readonly submitDisabledReason: string;
  };
  readonly procurement: {
    readonly heading: string;
    readonly parentLabel: string;
    readonly subordersLabel: string;
    readonly open: string;
    readonly reorder: string;
    readonly timeline: string;
    readonly confirmedVersion: string;
    readonly proposalWasBecame: string;
    readonly accept: string;
    readonly reject: string;
    readonly decisionRecorded: string;
  };
  readonly supplier: {
    readonly heading: string;
    readonly myOffers: string;
    readonly incomingSuborders: string;
    readonly respond: string;
    readonly proposeChange: string;
    readonly confirmNoChange: string;
    readonly updatePrice: string;
    readonly updateAvailability: string;
    readonly importCsv: string;
    readonly draftStorefront: string;
  };
  readonly operator: {
    readonly heading: string;
    readonly readonlyNotice: string;
    readonly queue: string;
  };
  readonly statuses: {
    readonly fulfillment: string;
    readonly agreement: string;
    readonly payment: string;
  };
  readonly a11y: {
    readonly skipToContent: string;
    readonly liveRegion: string;
  };
}

const ru: Messages = {
  app: {
    title: "HoReCa Marketplace — демо-прототип",
    subtitle: "Приватный P0-прототип на синтетических данных",
    demoBanner:
      "Демонстрационный режим. Данные вымышленные. Заказы, оплата и сообщения не отправляются.",
  },
  nav: {
    catalog: "Каталог",
    basket: "Корзина",
    lists: "Списки закупок",
    procurement: "Закупки",
    supplier: "Кабинет поставщика",
    operator: "Кабинет оператора",
    audit: "Журнал",
    notifications: "Уведомления",
  },
  common: {
    addToBasket: "В корзину",
    addToList: "В список",
    quantity: "Количество",
    price: "Цена",
    supplier: "Продавец",
    availability: "Наличие",
    updated: "обновлено",
    notStated: "не указано",
    needsConfirmation: "нужно подтвердить",
    moq: "MOQ (мин. по позиции)",
    orderStep: "Шаг заказа",
    minimumOrderValue: "Минимум заказа поставщика",
    freeDeliveryFrom: "Бесплатная доставка от",
    deliveryFee: "Стоимость доставки",
    deliveryUnknown: "стоимость доставки не указана",
    unitPrice: "Цена за единицу",
    incomparable: "несопоставимо",
    perSellUnit: "за продаваемую единицу",
    subtotal: "Подытог",
    total: "Итого по поставщику",
    submitDemo: "Отправить (демо)",
    remove: "Удалить",
    confirm: "Подтвердить",
    reject: "Отклонить",
    compare: "Сравнить",
    loading: "Загрузка…",
    empty: "Пусто",
    error: "Ошибка",
    stale: "устарело",
    viewDetails: "Подробнее",
    back: "Назад",
    demoOnly: "Демо",
  },
  catalog: {
    heading: "Каталог (демо-данные)",
    search: "Поиск по названию или SKU",
    category: "Категория",
    allCategories: "Все категории",
    supplierFilter: "Поставщик",
    allSuppliers: "Все поставщики",
    sortByUnitPrice: "Сортировать по цене за единицу",
  },
  basket: {
    heading: "Корзина (разбивается по поставщикам)",
    groupBySupplierIntro:
      "Корзина объединяет позиции для удобства, но перед отправкой делится на независимые подзаказы по поставщикам.",
    noDeliveryKnown: "Итог указан без доставки: стоимость доставки не известна.",
    notOneBill: "Это не единый счёт: каждый поставщик — отдельный подзаказ.",
    blockers: "Проблемы, мешающие отправке",
    amountToMinimumPrefix: "До минимума поставщика осталось",
    submitDisabledReason: "Отправка недоступна, пока есть проблемы.",
  },
  procurement: {
    heading: "Закупки",
    parentLabel: "Родительская закупка",
    subordersLabel: "Подзаказы по поставщикам",
    open: "Открыть",
    reorder: "Повторить закупку",
    timeline: "История статусов",
    confirmedVersion: "Подтверждённая версия",
    proposalWasBecame: "Было / Стало",
    accept: "Принять изменение",
    reject: "Отклонить изменение",
    decisionRecorded: "Решение записано",
  },
  supplier: {
    heading: "Кабинет поставщика (демо)",
    myOffers: "Мои предложения",
    incomingSuborders: "Входящие подзаказы",
    respond: "Ответить",
    proposeChange: "Предложить изменение",
    confirmNoChange: "Подтвердить без изменений",
    updatePrice: "Обновить цену",
    updateAvailability: "Обновить наличие",
    importCsv: "Импорт CSV (локально)",
    draftStorefront: "Витрина: черновик (демо), не публикуется",
  },
  operator: {
    heading: "Кабинет оператора (демо)",
    readonlyNotice:
      "Оператор видит только синтетические демо-данные и не может менять условия заказа.",
    queue: "Очередь демо-поставщиков",
  },
  statuses: {
    fulfillment: "Исполнение",
    agreement: "Согласование",
    payment: "Оплата",
  },
  a11y: {
    skipToContent: "Перейти к содержимому",
    liveRegion: "Обновления интерфейса",
  },
};

export const MESSAGES: Record<Locale, Messages> = {
  ru,
  // Kazakh is intentionally a partial scaffold; strings fall back to Russian.
  kk: ru,
};

export function getMessages(locale: Locale): Messages {
  return MESSAGES[locale];
}

export function defaultLocale(): Locale {
  const env = import.meta.env.VITE_DEFAULT_LOCALE;
  return env === "kk" ? "kk" : "ru";
}
