import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import type {
  CatalogOfferRow,
  MembershipRole,
  SupplierProfileRow,
} from "@/data/supabase/database.types";
import {
  addBuyerProcurementListItem,
  canManageBuyerProcurement,
  canReadBuyerProcurement,
  createBuyerDraftCartFromList,
  createBuyerProcurementList,
  deleteBuyerDraftCart,
  deleteBuyerProcurementList,
  loadBuyerDraftCarts,
  loadBuyerProcurementLists,
  removeBuyerDraftCartItem,
  removeBuyerProcurementListItem,
  renameBuyerProcurementList,
  updateBuyerDraftCartItemQuantity,
  updateBuyerProcurementListItemQuantity,
  workspaceErrorMessage,
  type BuyerDraftCartWithItems,
  type WorkspaceClient,
} from "@/data/supabase/workspace";

interface Props {
  readonly client: WorkspaceClient;
  readonly organizationId: string;
  readonly role: MembershipRole;
  readonly offers: readonly CatalogOfferRow[];
  readonly supplierProfiles: readonly SupplierProfileRow[];
}

type ProcurementList = Awaited<ReturnType<typeof loadBuyerProcurementLists>>[number];

export function BuyerProcurementListsPanel({
  client,
  organizationId,
  role,
  offers,
  supplierProfiles,
}: Props): ReactNode {
  const [lists, setLists] = useState<ProcurementList[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [newListName, setNewListName] = useState("");
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editedListName, setEditedListName] = useState("");
  const [quantityDrafts, setQuantityDrafts] = useState<Record<string, string>>({});
  const [addOfferIds, setAddOfferIds] = useState<Record<string, string>>({});
  const [addQuantities, setAddQuantities] = useState<Record<string, string>>({});
  const [draftCarts, setDraftCarts] = useState<BuyerDraftCartWithItems[]>([]);

  const canRead = canReadBuyerProcurement(role);
  const canManage = canManageBuyerProcurement(role);
  const offersById = useMemo(
    () => new Map(offers.map((offer) => [offer.id, offer])),
    [offers],
  );
  const supplierNamesById = useMemo(
    () =>
      new Map(
        supplierProfiles.map((profile) => [
          profile.organization_id,
          profile.display_name,
        ]),
      ),
    [supplierProfiles],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError("");
    if (!canRead) {
      setLists([]);
      setDraftCarts([]);
      setLoading(false);
      return () => {
        active = false;
      };
    }
    void Promise.all([
      loadBuyerProcurementLists(client, organizationId, role),
      loadBuyerDraftCarts(client, organizationId, role),
    ])
      .then(([listResult, cartResult]) => {
        if (active) {
          setLists(listResult);
          setDraftCarts(cartResult);
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
  }, [client, organizationId, role, canRead, refreshKey]);

  async function runMutation(action: () => Promise<unknown>, successMessage: string) {
    setBusy(true);
    setActionError("");
    setMessage("");
    try {
      await action();
      setMessage(successMessage);
      setRefreshKey((value) => value + 1);
    } catch (error: unknown) {
      setActionError(workspaceErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function createList(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await runMutation(
      () => createBuyerProcurementList(client, organizationId, role, newListName),
      "Список закупок сохранён в организации.",
    );
    setNewListName("");
  }

  async function saveListName(event: FormEvent<HTMLFormElement>, listId: string) {
    event.preventDefault();
    await runMutation(
      () =>
        renameBuyerProcurementList(client, organizationId, role, listId, editedListName),
      "Название списка обновлено.",
    );
    setEditingListId(null);
    setEditedListName("");
  }

  async function confirmDeleteList(list: ProcurementList) {
    if (!window.confirm(`Удалить список «${list.name}» и все его позиции?`)) return;
    await runMutation(
      () => deleteBuyerProcurementList(client, organizationId, role, list.id),
      "Список и его позиции удалены.",
    );
  }

  async function addOffer(event: FormEvent<HTMLFormElement>, listId: string) {
    event.preventDefault();
    const offerId = addOfferIds[listId] ?? "";
    const quantity = Number(addQuantities[listId] ?? "1");
    await runMutation(
      () =>
        addBuyerProcurementListItem(
          client,
          organizationId,
          role,
          listId,
          offerId,
          quantity,
        ),
      "Предложение добавлено в список.",
    );
    setAddOfferIds((current) => ({ ...current, [listId]: "" }));
    setAddQuantities((current) => ({ ...current, [listId]: "1" }));
  }

  async function saveQuantity(itemId: string, quantityValue: string) {
    await runMutation(
      () =>
        updateBuyerProcurementListItemQuantity(
          client,
          organizationId,
          role,
          itemId,
          Number(quantityValue),
        ),
      "Количество обновлено.",
    );
  }

  async function removeItem(itemId: string) {
    await runMutation(
      () => removeBuyerProcurementListItem(client, organizationId, role, itemId),
      "Позиция удалена из списка.",
    );
  }

  async function addListToNewDraftCart(list: ProcurementList) {
    await runMutation(
      () => createBuyerDraftCartFromList(client, organizationId, role, list.id),
      `Черновая корзина из списка «${list.name}» сохранена. Заказ не создаётся и поставщику не отправляется.`,
    );
  }

  async function saveDraftCartQuantity(itemId: string, quantityValue: string) {
    await runMutation(
      () =>
        updateBuyerDraftCartItemQuantity(
          client,
          organizationId,
          role,
          itemId,
          Number(quantityValue),
        ),
      "Количество в черновой корзине сохранено.",
    );
  }

  async function removeDraftCartItem(itemId: string) {
    await runMutation(
      () => removeBuyerDraftCartItem(client, organizationId, role, itemId),
      "Позиция удалена из черновой корзины.",
    );
  }

  async function confirmDeleteDraftCart(cart: BuyerDraftCartWithItems) {
    if (!window.confirm("Удалить черновую корзину и все её позиции?")) return;
    await runMutation(
      () => deleteBuyerDraftCart(client, organizationId, role, cart.id),
      "Черновая корзина удалена.",
    );
  }

  if (!canRead) return null;

  return (
    <section
      className="card account-section procurement-lists-panel"
      aria-labelledby="buyer-procurement-lists-title"
    >
      <h2 id="buyer-procurement-lists-title" className="card-title">
        Списки закупок
      </h2>
      <p className="small muted">
        Списки сохраняются в этой организации. Черновая корзина создаётся отдельно и не
        отправляется как заказ.
      </p>
      {loadError ? (
        <div className="notice notice-danger" role="alert">
          {loadError}
        </div>
      ) : null}
      {actionError ? (
        <div className="notice notice-danger" role="alert">
          {actionError}
        </div>
      ) : null}
      {message ? (
        <div className="notice notice-info" role="status">
          {message}
        </div>
      ) : null}
      {loading ? (
        <p className="loading" role="status">
          Загружаем списки закупок…
        </p>
      ) : null}

      {canManage ? (
        <form
          className="account-form account-form-grid procurement-list-create"
          onSubmit={(event) => void createList(event)}
        >
          <label className="field" htmlFor="new-procurement-list-name">
            Новый список
            <input
              id="new-procurement-list-name"
              required
              minLength={1}
              maxLength={120}
              value={newListName}
              onChange={(event) => setNewListName(event.target.value)}
            />
          </label>
          <button
            className="btn btn-primary"
            type="submit"
            disabled={busy || !newListName.trim()}
          >
            Создать список
          </button>
        </form>
      ) : null}

      {!loading && lists.length === 0 ? (
        <p className="empty">В этой организации пока нет сохранённых списков закупок.</p>
      ) : null}

      <div className="procurement-list-stack">
        {lists.map((list) => (
          <article
            className="procurement-list-card"
            key={list.id}
            aria-labelledby={`procurement-list-${list.id}`}
          >
            <div className="procurement-list-heading">
              {editingListId === list.id ? (
                <form
                  className="procurement-list-rename"
                  onSubmit={(event) => void saveListName(event, list.id)}
                >
                  <label className="field" htmlFor={`rename-list-${list.id}`}>
                    Название списка
                    <input
                      id={`rename-list-${list.id}`}
                      required
                      maxLength={120}
                      value={editedListName}
                      onChange={(event) => setEditedListName(event.target.value)}
                    />
                  </label>
                  <button
                    className="btn btn-primary"
                    type="submit"
                    disabled={busy || !editedListName.trim()}
                  >
                    Сохранить название
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="button"
                    onClick={() => setEditingListId(null)}
                    disabled={busy}
                  >
                    Отмена
                  </button>
                </form>
              ) : (
                <>
                  <h3 id={`procurement-list-${list.id}`}>{list.name}</h3>
                  <div className="procurement-list-actions">
                    {canManage ? (
                      <>
                        <button
                          className="btn"
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setEditingListId(list.id);
                            setEditedListName(list.name);
                          }}
                        >
                          Переименовать
                        </button>
                        <button
                          className="btn btn-ghost"
                          type="button"
                          disabled={busy}
                          onClick={() => void confirmDeleteList(list)}
                        >
                          Удалить список
                        </button>
                      </>
                    ) : null}
                    {canManage ? (
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={list.items.length === 0}
                        onClick={() => void addListToNewDraftCart(list)}
                      >
                        Добавить список в новую черновую корзину
                      </button>
                    ) : null}
                  </div>
                </>
              )}
            </div>

            {list.items.length === 0 ? (
              <p className="empty">Список пока пуст.</p>
            ) : (
              <ul className="account-list procurement-list-items">
                {list.items.map((item) => {
                  const offer = offersById.get(item.catalog_offer_id);
                  const quantityValue = quantityDrafts[item.id] ?? String(item.quantity);
                  return (
                    <li key={item.id}>
                      <div className="procurement-list-item-main">
                        <strong>{offer?.title ?? "Предложение сейчас недоступно"}</strong>
                        <span className="small muted">
                          {offer
                            ? `${supplierNamesById.get(offer.supplier_organization_id) ?? "Поставщик"} · ${offer.sell_unit_label}`
                            : "Связанное предложение больше не доступно в каталоге."}
                        </span>
                      </div>
                      <div className="procurement-list-item-controls">
                        {canManage ? (
                          <>
                            <label className="field" htmlFor={`quantity-${item.id}`}>
                              Количество (продаваемые единицы)
                              <input
                                id={`quantity-${item.id}`}
                                type="number"
                                inputMode="numeric"
                                min={1}
                                max={1_000_000}
                                step={1}
                                required
                                value={quantityValue}
                                onChange={(event) =>
                                  setQuantityDrafts((current) => ({
                                    ...current,
                                    [item.id]: event.target.value,
                                  }))
                                }
                              />
                            </label>
                            <button
                              className="btn"
                              type="button"
                              disabled={
                                busy ||
                                !Number.isInteger(Number(quantityValue)) ||
                                Number(quantityValue) <= 0 ||
                                Number(quantityValue) > 1_000_000 ||
                                Number(quantityValue) === item.quantity
                              }
                              onClick={() => void saveQuantity(item.id, quantityValue)}
                            >
                              Сохранить количество
                            </button>
                            <button
                              className="btn btn-ghost"
                              type="button"
                              disabled={busy}
                              onClick={() => void removeItem(item.id)}
                            >
                              Удалить позицию
                            </button>
                          </>
                        ) : (
                          <p className="procurement-list-quantity-readonly">
                            <span className="small muted">
                              Количество (продаваемые единицы)
                            </span>
                            <strong>{item.quantity}</strong>
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {canManage ? (
              <form
                className="account-form account-form-grid procurement-list-add-item"
                onSubmit={(event) => void addOffer(event, list.id)}
              >
                <label className="field" htmlFor={`offer-${list.id}`}>
                  Добавить опубликованное предложение
                  <select
                    id={`offer-${list.id}`}
                    required
                    value={addOfferIds[list.id] ?? ""}
                    onChange={(event) =>
                      setAddOfferIds((current) => ({
                        ...current,
                        [list.id]: event.target.value,
                      }))
                    }
                  >
                    <option value="">Выберите предложение</option>
                    {offers
                      .filter(
                        (offer) =>
                          !list.items.some((item) => item.catalog_offer_id === offer.id),
                      )
                      .map((offer) => (
                        <option key={offer.id} value={offer.id}>
                          {supplierNamesById.get(offer.supplier_organization_id) ??
                            "Поставщик"}{" "}
                          · {offer.title} · {offer.sell_unit_label}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field" htmlFor={`new-quantity-${list.id}`}>
                  Количество
                  <input
                    id={`new-quantity-${list.id}`}
                    type="number"
                    inputMode="numeric"
                    min={1}
                    max={1_000_000}
                    step={1}
                    required
                    value={addQuantities[list.id] ?? "1"}
                    onChange={(event) =>
                      setAddQuantities((current) => ({
                        ...current,
                        [list.id]: event.target.value,
                      }))
                    }
                  />
                </label>
                <button
                  className="btn"
                  type="submit"
                  disabled={
                    busy ||
                    !addOfferIds[list.id] ||
                    !Number.isInteger(Number(addQuantities[list.id] ?? "1")) ||
                    Number(addQuantities[list.id] ?? "1") <= 0 ||
                    Number(addQuantities[list.id] ?? "1") > 1_000_000
                  }
                >
                  Добавить предложение
                </button>
              </form>
            ) : null}
          </article>
        ))}
      </div>

      {draftCarts.length > 0 ? (
        <section
          className="draft-cart-preview"
          aria-labelledby="draft-cart-preview-title"
        >
          <h3 id="draft-cart-preview-title">Новые черновые корзины</h3>
          <p className="small muted">
            Корзины сохранены в этой организации. Они не являются заказами и не
            отправляются поставщикам; цена и наличие не подтверждаются и требуют повторной
            проверки.
          </p>
          {draftCarts.map((cart, index) => (
            <article className="draft-cart-card" key={cart.id}>
              <div className="procurement-list-heading">
                <h4>
                  Черновая корзина {draftCarts.length - index} · список «
                  {cart.source_list_name}»
                </h4>
                {canManage ? (
                  <button
                    className="btn btn-ghost"
                    type="button"
                    disabled={busy}
                    onClick={() => void confirmDeleteDraftCart(cart)}
                  >
                    Удалить черновик
                  </button>
                ) : null}
              </div>
              {cart.items.length === 0 ? (
                <p className="empty">В черновой корзине пока нет позиций.</p>
              ) : (
                <ul className="list-simple procurement-list-items">
                  {cart.items.map((item) => {
                    const offer = offersById.get(item.catalog_offer_id);
                    const quantityValue =
                      quantityDrafts[item.id] ?? String(item.quantity);
                    const offerChanged =
                      offer !== undefined && offer.version !== item.catalog_offer_version;
                    return (
                      <li key={item.id}>
                        <div className="procurement-list-item-main">
                          <strong>
                            {offer?.title ?? "Предложение сейчас недоступно"}
                          </strong>
                          <span className="small muted">
                            {offer
                              ? `${supplierNamesById.get(offer.supplier_organization_id) ?? "Поставщик"} · ${offer.sell_unit_label} · количество: ${item.quantity}`
                              : `Связанное предложение недоступно · количество: ${item.quantity}`}
                          </span>
                          <span className="small muted">
                            {!offer
                              ? "Предложение нужно проверить заново перед дальнейшими действиями."
                              : offerChanged
                                ? "Условия предложения изменились после создания корзины; повторно проверьте цену и наличие."
                                : "Цена и наличие не зафиксированы; перед будущим заказом условия нужно проверить заново."}
                          </span>
                        </div>
                        <div className="procurement-list-item-controls">
                          {canManage ? (
                            <>
                              <label
                                className="field"
                                htmlFor={`draft-cart-quantity-${item.id}`}
                              >
                                Количество в черновике (продаваемые единицы)
                                <input
                                  id={`draft-cart-quantity-${item.id}`}
                                  type="number"
                                  inputMode="numeric"
                                  min={1}
                                  max={1_000_000}
                                  step={1}
                                  required
                                  value={quantityValue}
                                  onChange={(event) =>
                                    setQuantityDrafts((current) => ({
                                      ...current,
                                      [item.id]: event.target.value,
                                    }))
                                  }
                                />
                              </label>
                              <button
                                className="btn"
                                type="button"
                                disabled={
                                  busy ||
                                  !Number.isInteger(Number(quantityValue)) ||
                                  Number(quantityValue) <= 0 ||
                                  Number(quantityValue) > 1_000_000 ||
                                  Number(quantityValue) === item.quantity
                                }
                                onClick={() =>
                                  void saveDraftCartQuantity(item.id, quantityValue)
                                }
                              >
                                Сохранить количество в корзине
                              </button>
                              <button
                                className="btn btn-ghost"
                                type="button"
                                disabled={busy}
                                onClick={() => void removeDraftCartItem(item.id)}
                              >
                                Удалить позицию
                              </button>
                            </>
                          ) : (
                            <p className="procurement-list-quantity-readonly">
                              <span className="small muted">
                                Количество (продаваемые единицы)
                              </span>
                              <strong>{item.quantity}</strong>
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </article>
          ))}
        </section>
      ) : null}
    </section>
  );
}
