import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/app/store";
import { computeCart } from "@/domain/cart";
import { canManageBasket, canManageProcurement } from "@/domain/authorization";
import { formatMoney } from "@/domain/money";
import { toSafeError } from "@/domain/errors";
import { describePackaging } from "@/components/format";
import { EmptyState, MoneyText, Notice, Section } from "@/components/primitives";

interface QuantityInputProps {
  readonly value: number;
  readonly min: number;
  readonly step: number;
  readonly disabled: boolean;
  readonly label: string;
  readonly onCommit: (quantity: number) => void;
}

/**
 * Keeps a local draft so a field can be cleared and retyped digit by digit;
 * a controlled `value` alone resets an empty field on the first keystroke.
 */
function QuantityInput({
  value,
  min,
  step,
  disabled,
  label,
  onCommit,
}: QuantityInputProps): ReactNode {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  return (
    <input
      type="number"
      min={min}
      step={step}
      value={draft}
      disabled={disabled}
      inputMode="numeric"
      aria-label={label}
      onChange={(e) => {
        const next = e.target.value;
        setDraft(next);
        if (next === "") return;
        const parsed = Number(next);
        if (Number.isSafeInteger(parsed) && parsed > 0) onCommit(parsed);
      }}
      onBlur={() => {
        const parsed = Number(draft);
        if (draft === "" || !Number.isSafeInteger(parsed) || parsed <= 0) {
          setDraft(String(value));
        }
      }}
    />
  );
}

export function BuyerBasket(): ReactNode {
  const { repo, session, membership, messages } = useApp();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const basket = repo.getBasketForOrg(session);
  const location = repo.getBasketLocation(session);
  const orgLocations = repo.locationsForOrg(membership.orgId);
  const computation = useMemo(
    () =>
      computeCart(basket, repo.offersById(), repo.suppliersById(), {
        nowIso: session.nowIso,
        locationZone: location?.deliveryZone ?? null,
      }),
    [basket, repo, session.nowIso, location?.deliveryZone],
  );

  const canEditBasket = canManageBasket(membership, basket.orgId);
  const canSubmit =
    canManageProcurement(membership, basket.orgId) && location !== undefined;

  function handleSubmit(): void {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const { procurementId } = repo.submitBasket({
        ...session,
        idempotencyKey: `submit-${session.membership.id}-${session.nowIso}`,
      });
      void navigate(`/procurement/${procurementId}`);
    } catch (e) {
      setError(toSafeError(e).message);
      setSubmitting(false);
    }
  }

  function handleSetLocation(locationId: string): void {
    setError(null);
    try {
      repo.setBasketLocation(session, locationId);
    } catch (e) {
      setError(toSafeError(e).message);
    }
  }

  const anyReady = computation.groups.some((g) => g.readyToSubmit);

  return (
    <div className="stack">
      <Section heading={messages.basket.heading} headingId="basket-heading">
        <div className="field">
          <label className="field">
            <span>Точка доставки (ваша организация)</span>
            <select
              value={location?.id ?? ""}
              onChange={(e) => handleSetLocation(e.target.value)}
              disabled={!canEditBasket}
            >
              {location ? null : <option value="">— выберите точку —</option>}
              {orgLocations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name} · зона {l.deliveryZone}
                </option>
              ))}
            </select>
          </label>
          <p className="muted small">
            Доставка проверяется поставщиком по зоне выбранной точки. Пока точка не
            выбрана или зона не подтверждена, отправка заблокирована.
          </p>
        </div>

        {basket.lines.length === 0 ? (
          <EmptyState message="Корзина пуста (демо). Добавьте позиции из каталога." />
        ) : (
          <>
            <Notice tone="info">{messages.basket.groupBySupplierIntro}</Notice>
            <Notice tone="warn">{messages.basket.notOneBill}</Notice>

            {computation.groups.map((group) => (
              <section
                key={group.supplierId}
                className="suborder-preview"
                aria-label={`Подзаказ: ${group.supplier.displayName}`}
              >
                <header className="suborder-preview-header">
                  <h3>{group.supplier.displayName}</h3>
                  <span className="muted small">
                    {group.supplier.coverageDemo} · покрытие зоны:{" "}
                    {group.zoneCoverage.state === "covered"
                      ? "подтверждено"
                      : group.zoneCoverage.state === "not_covered"
                        ? "не покрывает"
                        : "неизвестно"}
                  </span>
                </header>

                <table className="table">
                  <caption className="sr-only">Позиции подзаказа</caption>
                  <thead>
                    <tr>
                      <th scope="col">Позиция</th>
                      <th scope="col">Фасовка</th>
                      <th scope="col">Кол-во</th>
                      <th scope="col">Цена</th>
                      <th scope="col">{messages.common.subtotal}</th>
                      <th scope="col">Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.lines.map(({ line, offer, subtotal, problem }) => (
                      <tr key={line.id}>
                        <td data-label="Позиция">
                          {offer.title}
                          {problem ? (
                            <span className="error small block">
                              {problem.kind === "quantity"
                                ? problem.message
                                : problem.kind === "archived"
                                  ? "Позиция снята с продажи"
                                  : problem.kind === "price_stale"
                                    ? "Цена устарела — подтвердите"
                                    : "Цена не указана"}
                            </span>
                          ) : null}
                        </td>
                        <td data-label="Фасовка">{describePackaging(offer)}</td>
                        <td data-label="Кол-во">
                          <QuantityInput
                            value={line.quantity}
                            min={offer.packaging.moq}
                            step={offer.packaging.orderStep}
                            disabled={!canEditBasket}
                            label={`Количество: ${offer.title}`}
                            onCommit={(quantity) => {
                              try {
                                repo.setBasketLineQuantity(session, line.id, quantity);
                                setError(null);
                              } catch (e) {
                                setError(toSafeError(e).message);
                              }
                            }}
                          />
                        </td>
                        <td data-label="Цена">
                          <MoneyText value={offer.pricePerSellUnit.value} />
                        </td>
                        <td data-label="Подытог">
                          <MoneyText value={subtotal} />
                        </td>
                        <td data-label="Действие">
                          <button
                            type="button"
                            className="btn btn-ghost"
                            disabled={!canEditBasket}
                            onClick={() => repo.removeBasketLine(session, line.id)}
                          >
                            {messages.common.remove}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <dl className="conditions">
                  <div>
                    <dt>{messages.common.subtotal}</dt>
                    <dd>
                      <MoneyText value={group.subtotal} />
                    </dd>
                  </div>
                  <div>
                    <dt>{messages.common.minimumOrderValue}</dt>
                    <dd>
                      <MoneyText value={group.minimumOrderValue} />
                      {group.minimumMet ? (
                        <span className="ok small"> · достигнут</span>
                      ) : (
                        <span className="warn small">
                          {" "}
                          · {messages.basket.amountToMinimumPrefix}{" "}
                          {formatMoney(group.amountToMinimum)}
                        </span>
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt>{messages.common.deliveryFee}</dt>
                    <dd>
                      {group.delivery.known ? (
                        group.delivery.freeBecauseThresholdMet ? (
                          <span className="ok">бесплатно (достигнут порог)</span>
                        ) : (
                          <MoneyText value={group.delivery.fee} />
                        )
                      ) : (
                        <span className="muted">{messages.common.deliveryUnknown}</span>
                      )}
                    </dd>
                  </div>
                  {group.supplier.freeDeliveryThreshold ? (
                    <div>
                      <dt>{messages.common.freeDeliveryFrom}</dt>
                      <dd>
                        <MoneyText value={group.supplier.freeDeliveryThreshold} />
                      </dd>
                    </div>
                  ) : null}
                  <div>
                    <dt>{messages.common.total}</dt>
                    <dd>
                      {group.hasUnknownDelivery ? (
                        <>
                          <MoneyText value={group.total} />
                          <span className="muted small">
                            {" "}
                            · {messages.basket.noDeliveryKnown}
                          </span>
                        </>
                      ) : (
                        <MoneyText value={group.total} />
                      )}
                    </dd>
                  </div>
                </dl>

                {group.blockers.length > 0 ? (
                  <div>
                    <h4 className="blockers-title">{messages.basket.blockers}</h4>
                    <ul className="blockers">
                      {group.blockers.map((b, i) => (
                        <li key={i}>{b}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </section>
            ))}

            {computation.anyUnknownDelivery ? (
              <Notice tone="warn">
                По одному или нескольким поставщикам стоимость доставки неизвестна. Итог
                показан без неё и не считается как «бесплатно».
              </Notice>
            ) : null}

            <div className="submit-bar">
              <p className="muted small">
                Отправляются только готовые группы поставщиков. Группы, где не достигнут
                минимум, есть проблема с ценой или не подтверждена зона, остаются в
                корзине. Реальные заказы не создаются.
              </p>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!canSubmit || !anyReady || submitting}
                onClick={handleSubmit}
                title={
                  !canManageProcurement(membership, basket.orgId)
                    ? "Недостаточно прав (демо-роль)"
                    : location === undefined
                      ? "Сначала выберите точку доставки"
                      : undefined
                }
              >
                {messages.common.submitDemo}
              </button>
            </div>
            {!canManageProcurement(membership, basket.orgId) ? (
              <p className="muted small">
                Ваша демо-роль не может отправлять закупки (только просмотр/приёмка).
              </p>
            ) : null}
            {error ? (
              <p className="error" role="alert">
                {error}
              </p>
            ) : null}
          </>
        )}
      </Section>
    </div>
  );
}
