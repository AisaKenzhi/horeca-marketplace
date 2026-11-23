import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/data/supabase/client";
import type {
  CatalogAvailability,
  OrganizationType,
} from "@/data/supabase/database.types";
import {
  createBuyerLocation,
  createCatalogOffer,
  createOrganization,
  createSupplierProfile,
  loadWorkspace,
  setCatalogOfferPublished,
  workspaceErrorMessage,
  type BuyerLocationDraft,
  type CatalogOfferDraft,
  type WorkspaceClient,
  type WorkspaceSnapshot,
} from "@/data/supabase/workspace";
import { validateCatalogOffer } from "@/data/supabase/validation";

const EMPTY_WORKSPACE: WorkspaceSnapshot = {
  organizations: [],
  locations: [],
  supplierProfiles: [],
  offers: [],
  catalog: [],
};

export function AccountConfigurationNotice(): ReactNode {
  return (
    <main className="account-page">
      <section className="card account-card" aria-labelledby="account-title">
        <p className="eyebrow">Рабочий контур</p>
        <h1 id="account-title">Подключите тестовый Supabase</h1>
        <p>
          Рабочий аккаунт отделён от демонстрации и включается только при явной настройке
          Supabase.
        </p>
        <Notice tone="warn">
          Задайте <code>VITE_SUPABASE_URL</code> и публичный{" "}
          <code>VITE_SUPABASE_PUBLISHABLE_KEY</code> (или legacy{" "}
          <code>VITE_SUPABASE_ANON_KEY</code>) в локальном окружении. Не помещайте сюда
          service-role или secret key.
        </Notice>
        <p className="small muted">
          Этот экран не подключается к базе автоматически и не меняет работу
          демонстрационного каталога.
        </p>
      </section>
    </main>
  );
}

function Notice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warn" | "danger";
}): ReactNode {
  return <div className={`notice notice-${tone}`}>{children}</div>;
}

function AccountAuth({ client }: { client: WorkspaceClient }): ReactNode {
  const [mode, setMode] = useState<"sign_in" | "sign_up">("sign_in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      if (mode === "sign_up") {
        const { data, error: authError } = await client.auth.signUp({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
        if (!data.session) {
          setMessage(
            "Регистрация отправлена. Если подтверждение включено, проверьте почту.",
          );
        }
      } else {
        const { error: authError } = await client.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (authError) throw authError;
      }
    } catch (caught) {
      setError(workspaceErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  function changeMode(nextMode: "sign_in" | "sign_up") {
    setMode(nextMode);
    setError("");
    setMessage("");
  }

  return (
    <main className="account-page">
      <section className="card account-card" aria-labelledby="account-title">
        <p className="eyebrow">Рабочий контур</p>
        <h1 id="account-title">Вход в HoReCa Marketplace</h1>
        <p>
          Настоящая Supabase Auth-сессия. Демо-персоны не используются для определения
          доступа.
        </p>
        <div className="account-tabs" role="group" aria-label="Действие с аккаунтом">
          <button
            type="button"
            className={`btn ${mode === "sign_in" ? "btn-primary" : "btn-ghost"}`}
            aria-pressed={mode === "sign_in"}
            onClick={() => changeMode("sign_in")}
          >
            Войти
          </button>
          <button
            type="button"
            className={`btn ${mode === "sign_up" ? "btn-primary" : "btn-ghost"}`}
            aria-pressed={mode === "sign_up"}
            onClick={() => changeMode("sign_up")}
          >
            Создать аккаунт
          </button>
        </div>
        <form className="account-form" onSubmit={(event) => void submit(event)}>
          <label className="field" htmlFor="account-email">
            Email
            <input
              id="account-email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="field" htmlFor="account-password">
            Пароль
            <input
              id="account-password"
              type="password"
              autoComplete={mode === "sign_up" ? "new-password" : "current-password"}
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {message ? <Notice>{message}</Notice> : null}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Подождите…" : mode === "sign_up" ? "Зарегистрироваться" : "Войти"}
          </button>
        </form>
        <p className="small muted">
          Публичный ключ Supabase не выдаёт права на данные: доступ ограничивают grants и
          серверные RLS policies.
        </p>
      </section>
    </main>
  );
}

function useAuthenticatedUser(client: WorkspaceClient) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let authEventRevision = 0;
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      authEventRevision += 1;
      setUser(session?.user ?? null);
      setLoading(false);
    });
    const initialRevision = authEventRevision;

    void client.auth
      .getUser()
      .then(({ data: result, error }) => {
        if (!active || initialRevision !== authEventRevision) return;
        setUser(error ? null : result.user);
        setLoading(false);
      })
      .catch(() => {
        if (!active || initialRevision !== authEventRevision) return;
        setUser(null);
        setLoading(false);
      });

    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, [client]);

  return { user, loading };
}

function AccountWorkspaceReady({
  client,
  user,
}: {
  client: WorkspaceClient;
  user: User;
}): ReactNode {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(EMPTY_WORKSPACE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    void loadWorkspace(client)
      .then((workspace) => {
        if (active) setSnapshot(workspace);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(workspaceErrorMessage(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, user.id, refreshKey]);

  const activeOrganization = useMemo(
    () =>
      snapshot.organizations.find(
        (organization) => organization.id === selectedOrganizationId,
      ) ?? snapshot.organizations[0],
    [snapshot.organizations, selectedOrganizationId],
  );
  const activeProfile = snapshot.supplierProfiles.find(
    (profile) => profile.organization_id === activeOrganization?.id,
  );
  const activeOffers = snapshot.offers.filter(
    (offer) => offer.supplier_organization_id === activeOrganization?.id,
  );
  const activeLocations = snapshot.locations.filter(
    (location) => location.organization_id === activeOrganization?.id,
  );

  async function runAction(action: () => Promise<unknown>, successMessage: string) {
    setActionBusy(true);
    setActionError("");
    setActionMessage("");
    try {
      await action();
      setActionMessage(successMessage);
      setRefreshKey((value) => value + 1);
    } finally {
      setActionBusy(false);
    }
  }

  async function signOut() {
    setActionBusy(true);
    setActionError("");
    try {
      const { error } = await client.auth.signOut();
      if (error) throw error;
    } catch (error: unknown) {
      setActionError(workspaceErrorMessage(error));
    } finally {
      setActionBusy(false);
    }
  }

  if (loading) {
    return (
      <main className="account-page">
        <p className="loading" role="status">
          Загружаем рабочее пространство…
        </p>
      </main>
    );
  }

  return (
    <main className="account-page account-page-wide">
      <header className="account-header">
        <div>
          <p className="eyebrow">Рабочий контур · Supabase Auth</p>
          <h1>Рабочее пространство</h1>
          <p className="muted">Вы вошли как {user.email ?? "пользователь Supabase"}.</p>
        </div>
        <button
          className="btn"
          type="button"
          onClick={() => void signOut()}
          disabled={actionBusy}
        >
          Выйти
        </button>
      </header>

      {actionError ? <Notice tone="danger">{actionError}</Notice> : null}
      {actionMessage ? <Notice>{actionMessage}</Notice> : null}
      {loadError ? (
        <section className="card" aria-live="polite">
          <Notice tone="danger">{loadError}</Notice>
          <button
            className="btn"
            type="button"
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            Повторить загрузку
          </button>
        </section>
      ) : null}

      {snapshot.organizations.length === 0 && !loadError ? (
        <section className="card account-section">
          <h2 className="card-title">Создайте организацию</h2>
          <p>
            Роль владельца назначится базой в той же транзакции, что и организация. Тип
            организации нельзя будет вывести из демо-персоны.
          </p>
          <OrganizationForm
            busy={actionBusy}
            onCreate={(input) =>
              runAction(
                () => createOrganization(client, { ...input, userId: user.id }),
                "Организация создана. Её членство и роль владельца выданы базой.",
              )
            }
          />
        </section>
      ) : null}

      {snapshot.organizations.length > 0 ? (
        <>
          <section className="card account-section">
            <div className="account-section-heading">
              <div>
                <h2 className="card-title">Организация</h2>
                <p className="small muted">
                  Доступные вам организации возвращает серверная RLS.
                </p>
              </div>
              {snapshot.organizations.length > 1 ? (
                <label className="field" htmlFor="workspace-organization">
                  Рабочая организация
                  <select
                    id="workspace-organization"
                    value={activeOrganization?.id ?? ""}
                    onChange={(event) => setSelectedOrganizationId(event.target.value)}
                  >
                    {snapshot.organizations.map((organization) => (
                      <option key={organization.id} value={organization.id}>
                        {organization.name} ·{" "}
                        {organizationTypeLabel(organization.organization_type)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
            {activeOrganization ? (
              <div className="account-org-summary">
                <strong>{activeOrganization.name}</strong>
                <span>{organizationTypeLabel(activeOrganization.organization_type)}</span>
                <span>Роль: {activeOrganization.role}</span>
              </div>
            ) : null}
          </section>

          {activeOrganization?.organization_type === "buyer" ? (
            <section className="card account-section">
              <h2 className="card-title">Точки покупателя</h2>
              {activeLocations.length > 0 ? (
                <ul className="account-list">
                  {activeLocations.map((location) => (
                    <li key={location.id}>
                      <strong>{location.name}</strong>
                      <span>{location.address}</span>
                      {location.delivery_zone ? (
                        <span className="muted">Зона: {location.delivery_zone}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">Точек доставки пока нет.</p>
              )}
              <BuyerLocationForm
                busy={actionBusy}
                onCreate={(draft) =>
                  runAction(
                    () => createBuyerLocation(client, activeOrganization.id, draft),
                    "Точка добавлена к этой организации.",
                  )
                }
              />
            </section>
          ) : null}

          {activeOrganization?.organization_type === "supplier" ? (
            <section className="card account-section">
              <h2 className="card-title">Профиль поставщика</h2>
              {!activeProfile ? (
                <SupplierProfileForm
                  busy={actionBusy}
                  onCreate={(displayName) =>
                    runAction(
                      () =>
                        createSupplierProfile(client, activeOrganization.id, displayName),
                      "Профиль создан со статусом «На проверке».",
                    )
                  }
                />
              ) : (
                <>
                  <div className="account-org-summary">
                    <strong>{activeProfile.display_name}</strong>
                    <span>
                      Проверка: {verificationLabel(activeProfile.verification_status)}
                    </span>
                  </div>
                  {activeProfile.verification_status !== "approved" ? (
                    <Notice tone="warn">
                      Можно сохранять SKU как черновики. Покупатели не увидят предложения
                      до одобрения профиля; статус проверки нельзя менять из кабинета
                      поставщика.
                    </Notice>
                  ) : (
                    <Notice>
                      Профиль одобрен: можно публиковать подготовленные предложения.
                    </Notice>
                  )}
                  <h3 className="subsection-title">Предложения организации</h3>
                  {activeOffers.length > 0 ? (
                    <ul className="account-offer-list">
                      {activeOffers.map((offer) => (
                        <li key={offer.id} className="account-offer">
                          <div>
                            <strong>{offer.title}</strong>
                            <p className="small muted">
                              SKU {offer.supplier_sku} · {offer.category} ·{" "}
                              {offer.sell_unit_label} · {offer.pack_amount}{" "}
                              {offer.pack_base_unit}
                            </p>
                            <p className="small">
                              {formatPrice(offer.price_amount, offer.currency)} · MOQ{" "}
                              {offer.moq} · шаг {offer.order_step} ·{" "}
                              {availabilityLabel(offer.availability)}
                            </p>
                            <p className="small muted">
                              Цена обновлена: {formatTimestamp(offer.price_observed_at)};
                              наличие: {formatTimestamp(offer.availability_observed_at)}.
                            </p>
                          </div>
                          <div className="account-offer-actions">
                            <span
                              className={`badge ${offer.is_published ? "badge-fresh" : "badge-unknown"}`}
                            >
                              {offer.is_published ? "Опубликовано" : "Черновик"}
                            </span>
                            {activeProfile.verification_status === "approved" ? (
                              <button
                                className="btn"
                                type="button"
                                disabled={actionBusy}
                                onClick={() => {
                                  void runAction(
                                    () =>
                                      setCatalogOfferPublished(
                                        client,
                                        offer.id,
                                        !offer.is_published,
                                      ),
                                    offer.is_published
                                      ? "Предложение снято с публикации."
                                      : "Предложение опубликовано.",
                                  ).catch((error: unknown) =>
                                    setActionError(workspaceErrorMessage(error)),
                                  );
                                }}
                              >
                                {offer.is_published ? "Снять" : "Опубликовать"}
                              </button>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="empty">Каталог этой организации пока пуст.</p>
                  )}
                  <CatalogOfferForm
                    busy={actionBusy}
                    onCreate={(draft) =>
                      runAction(
                        () => createCatalogOffer(client, activeOrganization.id, draft),
                        "Предложение сохранено как черновик.",
                      )
                    }
                  />
                </>
              )}
            </section>
          ) : null}
        </>
      ) : null}

      <section className="card account-section" aria-labelledby="buyer-catalog-title">
        <h2 id="buyer-catalog-title" className="card-title">
          Каталог для покупателей
        </h2>
        <p className="small muted">
          Показываются только опубликованные предложения одобренных поставщиков. RLS
          ограничивает выборку на стороне базы; фильтрация в интерфейсе — дополнительная.
        </p>
        {snapshot.catalog.length > 0 ? (
          <ul className="catalog-list">
            {snapshot.catalog.map((offer) => (
              <li key={offer.id}>
                <article className="catalog-row account-catalog-row">
                  <div className="catalog-row-main">
                    <h3 className="offer-title">{offer.title}</h3>
                    <p className="offer-seller">
                      {snapshot.supplierProfiles.find(
                        (profile) =>
                          profile.organization_id === offer.supplier_organization_id,
                      )?.display_name ?? "Поставщик"}{" "}
                      · SKU {offer.supplier_sku}
                    </p>
                    <dl className="offer-grid">
                      <div>
                        <dt>Категория</dt>
                        <dd>{offer.category}</dd>
                      </div>
                      <div>
                        <dt>Продаваемая единица</dt>
                        <dd>{offer.sell_unit_label}</dd>
                      </div>
                      <div>
                        <dt>Упаковка</dt>
                        <dd>
                          {offer.pack_amount} {offer.pack_base_unit}
                        </dd>
                      </div>
                      <div>
                        <dt>Цена</dt>
                        <dd className="money">
                          {formatPrice(offer.price_amount, offer.currency)}
                        </dd>
                      </div>
                      <div>
                        <dt>Минимум / шаг</dt>
                        <dd>
                          {offer.moq} / {offer.order_step}
                        </dd>
                      </div>
                      <div>
                        <dt>Доступность</dt>
                        <dd>{availabilityLabel(offer.availability)}</dd>
                      </div>
                    </dl>
                    <p className="small muted">
                      Цена обновлена: {formatTimestamp(offer.price_observed_at)}; наличие:{" "}
                      {formatTimestamp(offer.availability_observed_at)}.
                    </p>
                  </div>
                </article>
              </li>
            ))}
          </ul>
        ) : (
          <p className="empty">
            Пока нет опубликованных предложений одобренных поставщиков.
          </p>
        )}
      </section>

      <section className="card account-section account-boundary-note">
        <h2 className="card-title">Граница этого среза</h2>
        <p>
          Здесь есть Auth, организации, членства, точки покупателя и базовые SKU.
          Приглашения сотрудников, operator review UI, корзина/закупки, доставка, оплаты,
          escrow и settlement не входят в этот первый engineering slice.
        </p>
      </section>
    </main>
  );
}

function OrganizationForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (input: {
    readonly name: string;
    readonly type: OrganizationType;
  }) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState("");
  const [type, setType] = useState<OrganizationType | "">("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!type) {
      setError("Выберите тип организации.");
      return;
    }
    try {
      await onCreate({ name, type });
      setName("");
    } catch (caught) {
      setError(workspaceErrorMessage(caught));
    }
  }

  return (
    <form
      className="account-form account-form-grid"
      onSubmit={(event) => void submit(event)}
    >
      <label className="field" htmlFor="organization-name">
        Название организации
        <input
          id="organization-name"
          required
          minLength={2}
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field" htmlFor="organization-type">
        Тип
        <select
          id="organization-type"
          required
          value={type}
          onChange={(event) => setType(event.target.value as OrganizationType | "")}
        >
          <option value="">Выберите тип</option>
          <option value="buyer">Покупатель</option>
          <option value="supplier">Поставщик</option>
        </select>
      </label>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        Создать организацию
      </button>
    </form>
  );
}

function BuyerLocationForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (draft: BuyerLocationDraft) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [deliveryZone, setDeliveryZone] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await onCreate({ name, address, deliveryZone });
      setName("");
      setAddress("");
      setDeliveryZone("");
    } catch (caught) {
      setError(workspaceErrorMessage(caught));
    }
  }

  return (
    <form
      className="account-form account-form-grid"
      onSubmit={(event) => void submit(event)}
    >
      <h3 className="subsection-title">Добавить точку</h3>
      <label className="field" htmlFor="location-name">
        Название точки
        <input
          id="location-name"
          required
          maxLength={120}
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <label className="field" htmlFor="location-address">
        Адрес
        <textarea
          id="location-address"
          required
          maxLength={500}
          rows={2}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
      </label>
      <label className="field" htmlFor="location-zone">
        Зона доставки (необязательно)
        <input
          id="location-zone"
          maxLength={120}
          value={deliveryZone}
          onChange={(event) => setDeliveryZone(event.target.value)}
        />
      </label>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        Добавить точку
      </button>
    </form>
  );
}

function SupplierProfileForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (displayName: string) => Promise<void>;
}): ReactNode {
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await onCreate(displayName);
      setDisplayName("");
    } catch (caught) {
      setError(workspaceErrorMessage(caught));
    }
  }

  return (
    <form
      className="account-form account-form-grid"
      onSubmit={(event) => void submit(event)}
    >
      <p>Создайте профиль поставщика. Он начнёт со статуса «На проверке».</p>
      <label className="field" htmlFor="supplier-display-name">
        Название для покупателей
        <input
          id="supplier-display-name"
          required
          minLength={2}
          maxLength={160}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        Создать профиль
      </button>
    </form>
  );
}

function CatalogOfferForm({
  busy,
  onCreate,
}: {
  busy: boolean;
  onCreate: (draft: CatalogOfferDraft) => Promise<void>;
}): ReactNode {
  const [supplierSku, setSupplierSku] = useState("");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("");
  const [sellUnitLabel, setSellUnitLabel] = useState("");
  const [unitsPerSellUnit, setUnitsPerSellUnit] = useState("1");
  const [packAmount, setPackAmount] = useState("");
  const [packBaseUnit, setPackBaseUnit] = useState<"" | "kg" | "l" | "piece">("");
  const [priceAmount, setPriceAmount] = useState("");
  const [currency, setCurrency] = useState("");
  const [moq, setMoq] = useState("1");
  const [orderStep, setOrderStep] = useState("1");
  const [availability, setAvailability] = useState<CatalogAvailability>("unknown");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    if (!packBaseUnit) {
      setError("Выберите базовую единицу упаковки.");
      return;
    }
    const amount = priceAmount.trim() ? Number(priceAmount) : null;
    const normalizedCurrency = amount === null ? null : currency.trim().toUpperCase();
    const draft: CatalogOfferDraft = {
      supplierSku,
      title,
      category,
      sellUnitLabel,
      unitsPerSellUnit: Number(unitsPerSellUnit),
      packAmount: Number(packAmount),
      packBaseUnit,
      priceAmount: amount,
      currency: normalizedCurrency,
      moq: Number(moq),
      orderStep: Number(orderStep),
      availability,
    };
    const validationError = validateCatalogOffer(draft);
    if (validationError) {
      setError(validationError);
      return;
    }
    try {
      await onCreate(draft);
      setSupplierSku("");
      setTitle("");
      setCategory("");
      setSellUnitLabel("");
      setPackAmount("");
      setPackBaseUnit("");
      setPriceAmount("");
      setCurrency("");
      setMoq("1");
      setOrderStep("1");
      setAvailability("unknown");
    } catch (caught) {
      setError(workspaceErrorMessage(caught));
    }
  }

  return (
    <details className="account-offer-editor">
      <summary>Добавить SKU как черновик</summary>
      <form
        className="account-form account-form-grid"
        onSubmit={(event) => void submit(event)}
      >
        <label className="field" htmlFor="offer-sku">
          SKU поставщика
          <input
            id="offer-sku"
            required
            maxLength={80}
            value={supplierSku}
            onChange={(event) => setSupplierSku(event.target.value)}
          />
        </label>
        <label className="field" htmlFor="offer-title">
          Название товара
          <input
            id="offer-title"
            required
            maxLength={180}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label className="field" htmlFor="offer-category">
          Категория
          <input
            id="offer-category"
            required
            maxLength={80}
            value={category}
            onChange={(event) => setCategory(event.target.value)}
          />
        </label>
        <label className="field" htmlFor="offer-sell-unit">
          Продаваемая единица
          <input
            id="offer-sell-unit"
            required
            maxLength={120}
            placeholder="например, ящик"
            value={sellUnitLabel}
            onChange={(event) => setSellUnitLabel(event.target.value)}
          />
        </label>
        <label className="field" htmlFor="offer-units-per-sell">
          Единиц в продаваемой упаковке
          <input
            id="offer-units-per-sell"
            type="number"
            min={1}
            step={1}
            required
            value={unitsPerSellUnit}
            onChange={(event) => setUnitsPerSellUnit(event.target.value)}
          />
        </label>
        <label className="field" htmlFor="offer-pack-amount">
          Количество в упаковке
          <input
            id="offer-pack-amount"
            type="number"
            min="0.001"
            step="0.001"
            required
            value={packAmount}
            onChange={(event) => setPackAmount(event.target.value)}
          />
        </label>
        <label className="field" htmlFor="offer-pack-unit">
          Базовая единица упаковки
          <select
            id="offer-pack-unit"
            required
            value={packBaseUnit}
            onChange={(event) =>
              setPackBaseUnit(event.target.value as "" | "kg" | "l" | "piece")
            }
          >
            <option value="">Выберите</option>
            <option value="kg">кг</option>
            <option value="l">л</option>
            <option value="piece">штука</option>
          </select>
        </label>
        <label className="field" htmlFor="offer-price">
          Цена за продаваемую единицу
          <input
            id="offer-price"
            type="number"
            min="0.0001"
            step="0.0001"
            value={priceAmount}
            onChange={(event) => setPriceAmount(event.target.value)}
          />
        </label>
        <label className="field" htmlFor="offer-currency">
          Код валюты (без валюты цена не публикуется)
          <input
            id="offer-currency"
            autoCapitalize="characters"
            maxLength={3}
            placeholder="EUR"
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
          />
        </label>
        <label className="field" htmlFor="offer-moq">
          Минимум заказа, продаваемых единиц
          <input
            id="offer-moq"
            type="number"
            min={1}
            step={1}
            required
            value={moq}
            onChange={(event) => setMoq(event.target.value)}
          />
        </label>
        <label className="field" htmlFor="offer-order-step">
          Шаг заказа
          <input
            id="offer-order-step"
            type="number"
            min={1}
            step={1}
            required
            value={orderStep}
            onChange={(event) => setOrderStep(event.target.value)}
          />
        </label>
        <label className="field" htmlFor="offer-availability">
          Доступность
          <select
            id="offer-availability"
            value={availability}
            onChange={(event) =>
              setAvailability(event.target.value as CatalogAvailability)
            }
          >
            <option value="unknown">Неизвестно</option>
            <option value="in_stock">В наличии</option>
            <option value="low_stock">Мало</option>
            <option value="out_of_stock">Нет в наличии</option>
            <option value="on_request">Под заказ</option>
          </select>
        </label>
        <p className="small muted account-form-full">
          Цена сохраняется как сумма в явно указанной валюте без конвертации. Новый SKU
          всегда создаётся как черновик; статус поставщика и публикация контролируются
          RLS.
        </p>
        {error ? (
          <div className="account-form-full">
            <Notice tone="danger">{error}</Notice>
          </div>
        ) : null}
        <button
          className="btn btn-primary account-form-full"
          type="submit"
          disabled={busy}
        >
          Сохранить черновик
        </button>
      </form>
    </details>
  );
}

function organizationTypeLabel(type: OrganizationType): string {
  return type === "buyer" ? "Покупатель" : "Поставщик";
}

function verificationLabel(status: "pending" | "approved" | "rejected"): string {
  switch (status) {
    case "pending":
      return "На проверке";
    case "approved":
      return "Одобрена";
    case "rejected":
      return "Отклонена";
  }
}

function availabilityLabel(status: CatalogAvailability): string {
  switch (status) {
    case "in_stock":
      return "В наличии";
    case "low_stock":
      return "Мало";
    case "out_of_stock":
      return "Нет в наличии";
    case "on_request":
      return "Под заказ";
    case "unknown":
      return "Неизвестно";
  }
}

function formatPrice(amount: number | null, currency: string | null): string {
  if (amount === null || currency === null) return "Цена не указана";
  return `${amount.toString()} ${currency}`;
}

function formatTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) return "время неизвестно";
  return parsed.toLocaleString();
}

export function AccountWorkspace(): ReactNode {
  const client = getSupabaseClient();
  if (!client) return <AccountConfigurationNotice />;
  return <AccountWorkspaceWithClient client={client} />;
}

function AccountWorkspaceWithClient({ client }: { client: WorkspaceClient }): ReactNode {
  const { user, loading } = useAuthenticatedUser(client);
  if (loading) {
    return (
      <main className="account-page">
        <p className="loading" role="status">
          Проверяем Supabase Auth-сессию…
        </p>
      </main>
    );
  }
  return user ? (
    <AccountWorkspaceReady client={client} user={user} />
  ) : (
    <AccountAuth client={client} />
  );
}
