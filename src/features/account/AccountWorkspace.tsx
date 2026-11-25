import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/data/supabase/client";
import { evaluateFreshness } from "@/domain/freshness";
import { BuyerProcurementListsPanel } from "@/features/account/BuyerProcurementListsPanel";
import { BuyerTermsReviewPanel } from "@/features/account/BuyerTermsReviewPanel";
import { membershipRoleLabel } from "@/features/account/roleLabels";
import { CatalogOfferTermsForm } from "@/features/account/CatalogOfferTermsForm";
import { OrganizationAccess } from "@/features/account/OrganizationAccess";
import { SupplierCatalogImportPanel } from "@/features/account/SupplierCatalogImportPanel";
import { SupplierSuborderInboxPanel } from "@/features/account/SupplierSuborderInboxPanel";
import {
  acceptOrganizationInvitation,
  canManageOrganization,
} from "@/data/supabase/workspace";
import { useRef } from "react";
import type {
  BuyerLocationRow,
  CatalogAvailability,
  OrganizationType,
} from "@/data/supabase/database.types";
import {
  canManageSupplierCatalog,
  createBuyerLocation,
  createCatalogOffer,
  deleteBuyerLocation,
  createOrganization,
  createSupplierProfile,
  loadWorkspace,
  setCatalogOfferPublished,
  updateBuyerLocation,
  updateCatalogOfferTerms,
  updateSupplierProfileDisplayName,
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
  return (
    <div
      className={`notice notice-${tone}`}
      role={tone === "danger" ? "alert" : undefined}
    >
      {children}
    </div>
  );
}

function AccountFreshnessNotice({
  value,
  observedAt,
  label,
}: {
  readonly value: unknown;
  readonly observedAt: string | null;
  readonly label: string;
}): ReactNode {
  const freshness = evaluateFreshness(
    { value: value ?? null, observedAt },
    new Date().toISOString(),
  );
  if (freshness.state === "fresh") return null;
  return (
    <strong className="freshness-warning">
      ({label}:{" "}
      {freshness.state === "stale" ? "наблюдение устарело" : "свежесть не подтверждена"})
    </strong>
  );
}

function AccountAuth({
  client,
  inviteToken,
}: {
  client: WorkspaceClient;
  inviteToken: string | null;
}): ReactNode {
  const [mode, setMode] = useState<"sign_in" | "sign_up" | "recover">("sign_in");
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
      if (mode === "recover") {
        const { error: authError } = await client.auth.resetPasswordForEmail(
          email.trim(),
          { redirectTo: `${window.location.origin}/account` },
        );
        if (authError) throw authError;
        setMessage(
          "Если адрес зарегистрирован, отправим ссылку для восстановления доступа. Мы не сообщаем, существует ли аккаунт.",
        );
      } else if (mode === "sign_up") {
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

  function changeMode(nextMode: "sign_in" | "sign_up" | "recover") {
    setMode(nextMode);
    setError("");
    setMessage("");
  }

  return (
    <main className="account-page">
      <section className="card account-card" aria-labelledby="account-title">
        {inviteToken ? (
          <Notice>
            Вы открыли приглашение. Войдите или создайте аккаунт с совпадающим email,
            чтобы принять его.
          </Notice>
        ) : null}
        <p className="eyebrow">Рабочий контур</p>
        <h1 id="account-title">Вход в HoReCa Marketplace</h1>
        <p>
          Настоящая Supabase Auth-сессия. Демо-персоны не используются для определения
          доступа.
        </p>
        {mode !== "recover" ? (
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
        ) : null}
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
          {mode !== "recover" ? (
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
          ) : null}
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {message ? <Notice>{message}</Notice> : null}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy
              ? "Подождите…"
              : mode === "sign_up"
                ? "Зарегистрироваться"
                : mode === "recover"
                  ? "Отправить ссылку"
                  : "Войти"}
          </button>
        </form>
        {mode === "recover" ? (
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => changeMode("sign_in")}
          >
            Вернуться ко входу
          </button>
        ) : (
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => changeMode("recover")}
          >
            Забыли пароль?
          </button>
        )}
        <p className="small muted">
          Публичный ключ Supabase не выдаёт права на данные: доступ ограничивают grants и
          серверные RLS policies.
        </p>
      </section>
    </main>
  );
}

export function AccountPasswordUpdate({
  onUpdatePassword,
  onDone,
}: {
  readonly onUpdatePassword: (password: string) => Promise<void>;
  readonly onDone: () => void;
}): ReactNode {
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
      await onUpdatePassword(password);
      setMessage("Пароль обновлён. Используйте его при следующем входе.");
    } catch (caught) {
      setError(workspaceErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="account-page">
      <section className="card account-card" aria-labelledby="password-update-title">
        <h1 id="password-update-title">Новый пароль</h1>
        <p className="small muted">
          Ссылка восстановления подтверждена. Новый пароль сохраняется через Supabase Auth
          только для текущей сессии; демо-персоны здесь не используются.
        </p>
        <form className="account-form" onSubmit={(event) => void submit(event)}>
          <label className="field" htmlFor="new-password">
            Новый пароль
            <input
              id="new-password"
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? <Notice tone="danger">{error}</Notice> : null}
          {message ? <Notice>{message}</Notice> : null}
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? "Подождите…" : "Сохранить новый пароль"}
          </button>
        </form>
        {message ? (
          <button className="btn" type="button" onClick={onDone}>
            Перейти в рабочее пространство
          </button>
        ) : null}
      </section>
    </main>
  );
}

function useAuthenticatedUser(client: WorkspaceClient, onPasswordRecovery: () => void) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const recoveryRef = useRef(onPasswordRecovery);
  recoveryRef.current = onPasswordRecovery;

  useEffect(() => {
    let active = true;
    let authEventRevision = 0;
    const { data } = client.auth.onAuthStateChange((event, session) => {
      authEventRevision += 1;
      if (event === "PASSWORD_RECOVERY") recoveryRef.current();
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

export function AccountWorkspaceReady({
  client,
  user,
  inviteToken,
}: {
  client: WorkspaceClient;
  user: User;
  inviteToken: string | null;
}): ReactNode {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(EMPTY_WORKSPACE);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const acceptedToken = useRef<string | null>(null);
  const loadedUserId = useRef<string | null>(null);
  const [invitationBusy, setInvitationBusy] = useState(false);
  const [inviteNotice, setInviteNotice] = useState("");
  const [editingLocationId, setEditingLocationId] = useState<string | null>(null);
  const [editingProfileName, setEditingProfileName] = useState(false);

  useEffect(() => {
    let active = true;
    if (loadedUserId.current !== user.id) {
      loadedUserId.current = null;
      setSnapshot(EMPTY_WORKSPACE);
      setLoading(true);
    }
    setLoadError("");
    void loadWorkspace(client)
      .then((workspace) => {
        if (active) {
          setSnapshot(workspace);
          loadedUserId.current = user.id;
        }
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
  const canEditCatalogOffers =
    activeOrganization !== undefined &&
    activeProfile?.verification_status === "approved" &&
    canManageSupplierCatalog(activeOrganization.role);

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

  async function acceptInvitation() {
    if (!inviteToken || acceptedToken.current === inviteToken) return;
    acceptedToken.current = inviteToken;
    setInvitationBusy(true);
    setInviteNotice("");
    try {
      await acceptOrganizationInvitation(client, inviteToken);
      setInviteNotice(
        "Приглашение принято. Организация доступна в рабочем пространстве.",
      );
      setRefreshKey((value) => value + 1);
    } catch {
      acceptedToken.current = null;
      setInviteNotice(
        "Ссылка недействительна: истекла, отозвана, уже использована или оформлена на другой email. Обратитесь к администратору организации за новой ссылкой.",
      );
    } finally {
      setInvitationBusy(false);
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

      {inviteNotice ? (
        <Notice tone={inviteNotice.startsWith("Приглашение принято") ? "info" : "danger"}>
          {inviteNotice}
        </Notice>
      ) : null}
      {inviteToken && !inviteNotice.startsWith("Приглашение принято") ? (
        <section className="card account-section">
          <h2 className="card-title">Приглашение в организацию</h2>
          <p>
            Вы вошли как {user.email ?? "пользователь Supabase"}. Принимать приглашение
            можно только под адресом, на который оно оформлено.
          </p>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => void acceptInvitation()}
            disabled={invitationBusy}
          >
            {invitationBusy ? "Принимаем…" : "Принять приглашение"}
          </button>
        </section>
      ) : null}
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
                <span>
                  Роль: {membershipRoleLabel(activeOrganization.role)}
                  {activeOrganization.role === "viewer" ? " (только чтение)" : ""}
                </span>
              </div>
            ) : null}
          </section>

          {activeOrganization && canManageOrganization(activeOrganization.role) ? (
            <OrganizationAccess
              client={client}
              organizationId={activeOrganization.id}
              userId={user.id}
              actorRole={activeOrganization.role}
            />
          ) : null}

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
                      {canManageOrganization(activeOrganization.role) ? (
                        <div className="action-row">
                          <button
                            className="btn btn-ghost"
                            type="button"
                            onClick={() => setEditingLocationId(location.id)}
                          >
                            Изменить точку
                          </button>
                          <button
                            className="btn btn-ghost"
                            type="button"
                            disabled={actionBusy}
                            onClick={() => {
                              const confirmed = window.confirm(
                                `Удалить точку «${location.name}»? Если она указана в сохранённой корзине или запросе, удаление будет отклонено.`,
                              );
                              if (!confirmed) return;
                              void runAction(
                                () =>
                                  deleteBuyerLocation(
                                    client,
                                    activeOrganization.id,
                                    location.id,
                                  ),
                                "Точка удалена из этой организации.",
                              ).catch((error: unknown) => {
                                setActionError(workspaceErrorMessage(error));
                              });
                            }}
                          >
                            Удалить точку
                          </button>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="empty">Точек доставки пока нет.</p>
              )}
              {editingLocationId &&
              activeLocations.some((location) => location.id === editingLocationId) ? (
                <BuyerLocationForm
                  key={editingLocationId}
                  busy={actionBusy}
                  initial={activeLocations.find(
                    (location) => location.id === editingLocationId,
                  )}
                  onSave={(draft) =>
                    runAction(
                      () =>
                        updateBuyerLocation(
                          client,
                          activeOrganization.id,
                          editingLocationId,
                          draft,
                        ),
                      "Точка обновлена.",
                    ).then(() => setEditingLocationId(null))
                  }
                  onCancel={() => setEditingLocationId(null)}
                />
              ) : (
                <BuyerLocationForm
                  busy={actionBusy}
                  initial={undefined}
                  onSave={(draft) =>
                    runAction(
                      () => createBuyerLocation(client, activeOrganization.id, draft),
                      "Точка добавлена к этой организации.",
                    )
                  }
                />
              )}
            </section>
          ) : null}

          {activeOrganization?.organization_type === "buyer" ? (
            <BuyerProcurementListsPanel
              client={client}
              organizationId={activeOrganization.id}
              role={activeOrganization.role}
              locations={activeLocations}
              offers={snapshot.catalog}
              supplierProfiles={snapshot.supplierProfiles}
            />
          ) : null}

          {activeOrganization?.organization_type === "buyer" ? (
            <BuyerTermsReviewPanel
              client={client}
              organizationId={activeOrganization.id}
              organizationType="buyer"
              role={activeOrganization.role}
            />
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
                    {canManageOrganization(activeOrganization.role) ? (
                      <button
                        className="btn btn-ghost"
                        type="button"
                        onClick={() => setEditingProfileName(true)}
                      >
                        Изменить название
                      </button>
                    ) : null}
                  </div>
                  {editingProfileName &&
                  canManageOrganization(activeOrganization.role) ? (
                    <SupplierProfileNameForm
                      initialName={activeProfile.display_name}
                      busy={actionBusy}
                      onSave={(displayName) =>
                        runAction(
                          () =>
                            updateSupplierProfileDisplayName(
                              client,
                              activeOrganization.id,
                              displayName,
                            ),
                          "Название профиля обновлено.",
                        ).then(() => setEditingProfileName(false))
                      }
                      onCancel={() => setEditingProfileName(false)}
                    />
                  ) : null}
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
                            {canEditCatalogOffers ? (
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
                          {canEditCatalogOffers ? (
                            <CatalogOfferTermsForm
                              offerId={offer.id}
                              priceAmount={offer.price_amount}
                              currency={offer.currency}
                              availability={offer.availability}
                              busy={actionBusy}
                              onUpdate={(terms) =>
                                runAction(
                                  () =>
                                    updateCatalogOfferTerms(
                                      client,
                                      activeOrganization.id,
                                      offer.id,
                                      terms,
                                    ),
                                  "Цена и наличие предложения обновлены.",
                                ).then(() => undefined)
                              }
                            />
                          ) : null}
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

          {activeOrganization?.organization_type === "supplier" ? (
            <SupplierSuborderInboxPanel
              client={client}
              organizationId={activeOrganization.id}
              organizationType="supplier"
              role={activeOrganization.role}
            />
          ) : null}

          {activeOrganization?.organization_type === "supplier" &&
          activeProfile &&
          canManageSupplierCatalog(activeOrganization.role) ? (
            <SupplierCatalogImportPanel
              client={client}
              organizationId={activeOrganization.id}
              role={activeOrganization.role}
              verificationStatus={activeProfile.verification_status}
              onApplied={() => setRefreshKey((value) => value + 1)}
            />
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
                      Цена обновлена: {formatTimestamp(offer.price_observed_at)}{" "}
                      <AccountFreshnessNotice
                        value={offer.price_amount}
                        observedAt={offer.price_observed_at}
                        label="цена"
                      />
                      ; наличие: {formatTimestamp(offer.availability_observed_at)}{" "}
                      <AccountFreshnessNotice
                        value={offer.availability}
                        observedAt={offer.availability_observed_at}
                        label="наличие"
                      />
                      .
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
          Здесь есть Auth, организации, членства, точки покупателя, базовые SKU и
          сохранённые списки закупок. Добавление списка формирует только черновую корзину
          в текущем просмотре; заказ не создаётся и не отправляется. Почтовый провайдер не
          подключён: приглашения передаются вручную по ссылке. Operator review UI,
          отправка закупки, доставка, оплаты, escrow и settlement не входят в этот
          engineering slice.
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
  initial,
  onSave,
  onCancel,
}: {
  busy: boolean;
  initial: BuyerLocationRow | undefined;
  onSave: (draft: BuyerLocationDraft) => Promise<void>;
  onCancel?: () => void;
}): ReactNode {
  const [name, setName] = useState(initial?.name ?? "");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [deliveryZone, setDeliveryZone] = useState(initial?.delivery_zone ?? "");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await onSave({ name, address, deliveryZone });
      if (!initial) {
        setName("");
        setAddress("");
        setDeliveryZone("");
      }
    } catch (caught) {
      setError(workspaceErrorMessage(caught));
    }
  }

  return (
    <form
      className="account-form account-form-grid"
      onSubmit={(event) => void submit(event)}
    >
      <h3 className="subsection-title">
        {initial ? `Изменить точку «${initial.name}»` : "Добавить точку"}
      </h3>
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
        {initial ? "Сохранить точку" : "Добавить точку"}
      </button>
      {onCancel ? (
        <button className="btn btn-ghost" type="button" onClick={onCancel}>
          Отмена
        </button>
      ) : null}
    </form>
  );
}

function SupplierProfileNameForm({
  initialName,
  busy,
  onSave,
  onCancel,
}: {
  readonly initialName: string;
  readonly busy: boolean;
  readonly onSave: (displayName: string) => Promise<void>;
  readonly onCancel: () => void;
}): ReactNode {
  const [displayName, setDisplayName] = useState(initialName);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    try {
      await onSave(displayName);
    } catch (caught) {
      setError(workspaceErrorMessage(caught));
    }
  }

  return (
    <form className="account-form" onSubmit={(event) => void submit(event)}>
      <label className="field" htmlFor="supplier-profile-name-edit">
        Название профиля
        <input
          id="supplier-profile-name-edit"
          required
          minLength={2}
          maxLength={160}
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </label>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <button className="btn btn-primary" type="submit" disabled={busy}>
        Сохранить название
      </button>
      <button className="btn btn-ghost" type="button" onClick={onCancel}>
        Отмена
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
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  // A recovery link's PASSWORD_RECOVERY event can be emitted before React has
  // subscribed, and auth-js clears the fragment during initialisation. Capture
  // the intent synchronously on first render, before either can happen.
  const [recoveryLink] = useState(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    return params.get("type") === "recovery" && params.has("access_token");
  });
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const token = params.get("invite");
    if (token) {
      setInviteToken(token);
      window.history.replaceState(
        window.history.state,
        "",
        `${window.location.pathname}${window.location.search}`,
      );
    }
  }, []);
  if (!client) return <AccountConfigurationNotice />;
  return (
    <AccountWorkspaceWithClient
      client={client}
      inviteToken={inviteToken}
      recoveryLink={recoveryLink}
    />
  );
}

function AccountWorkspaceWithClient({
  client,
  inviteToken,
  recoveryLink,
}: {
  client: WorkspaceClient;
  inviteToken: string | null;
  recoveryLink: boolean;
}): ReactNode {
  const [recoveryMode, setRecoveryMode] = useState(recoveryLink);
  const { user, loading } = useAuthenticatedUser(client, () => setRecoveryMode(true));
  if (loading) {
    return (
      <main className="account-page">
        <p className="loading" role="status">
          Проверяем Supabase Auth-сессию…
        </p>
      </main>
    );
  }
  if (recoveryMode) {
    return (
      <AccountPasswordUpdate
        onUpdatePassword={async (password) => {
          const { error } = await client.auth.updateUser({ password });
          if (error) throw error;
        }}
        onDone={() => setRecoveryMode(false)}
      />
    );
  }
  return user ? (
    <AccountWorkspaceReady
      key={user.id}
      client={client}
      user={user}
      inviteToken={inviteToken}
    />
  ) : (
    <AccountAuth client={client} inviteToken={inviteToken} />
  );
}
