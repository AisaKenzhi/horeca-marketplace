import { useMemo, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useApp } from "@/app/store";
import { computeCart } from "@/domain/cart";
import { canManageProcurement } from "@/domain/authorization";
import { formatMoney } from "@/domain/money";
import { describePackaging } from "@/components/format";
import { EmptyState, MoneyText, Notice, Section } from "@/components/primitives";

export function BuyerBasket(): ReactNode {
  const { repo, session, membership, messages } = useApp();
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  const basket = repo.getBasketForOrg(session);
  const computation = useMemo(
    () => computeCart(basket, repo.offersById(), repo.suppliersById()),
    [basket, repo],
  );

  const canSubmit = canManageProcurement(membership, basket.orgId);

  function handleSubmit(): void {
    try {
      const { procurementId } = repo.submitBasket(session);
      navigate(`/procurement/${procurementId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : messages.common.error);
    }
  }

  if (basket.lines.length === 0) {
    return (
      <Section heading={messages.basket.heading}>
        <EmptyState message="Корзина пуста (демо). Добавьте позиции из каталога." />
      </Section>
    );
  }

  return (
    <div className="stack">
      <Section heading={messages.basket.heading} headingId="basket-heading">
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
              <span className="muted small">{group.supplier.coverageDemo}</span>
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
                              : "Цена не указана"}
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Фасовка">{describePackaging(offer)}</td>
                    <td data-label="Кол-во">
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={line.quantity}
                        onChange={(e) =>
                          repo.setBasketLineQuantity(
                            session,
                            line.id,
                            Math.max(1, Number(e.target.value)),
                          )
                        }
                        aria-label={`Количество: ${offer.title}`}
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
            минимум или есть проблема, остаются в корзине. Реальные заказы не создаются.
          </p>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!canSubmit || !computation.groups.some((g) => g.readyToSubmit)}
            onClick={handleSubmit}
            title={!canSubmit ? "Недостаточно прав (демо-роль)" : undefined}
          >
            {messages.common.submitDemo}
          </button>
        </div>
        {!canSubmit ? (
          <p className="muted small">
            Ваша демо-роль не может отправлять закупки (только просмотр/приёмка).
          </p>
        ) : null}
        {error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : null}
      </Section>
    </div>
  );
}
