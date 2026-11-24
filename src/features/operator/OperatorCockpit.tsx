import { type ReactNode } from "react";
import { useApp } from "@/app/store";
import { MoneyText, Notice, Section, StatusPill } from "@/components/primitives";
import { canModerateContent } from "@/domain/authorization";

/**
 * Operator cockpit.
 *
 * Shows a synthetic demo queue only. Operators cannot change prices, orders, or
 * user roles here; that constraint is enforced in the domain layer too.
 */
export function OperatorCockpit(): ReactNode {
  const { state, membership, messages, repo, session } = useApp();

  if (!canModerateContent(membership)) {
    return (
      <Section heading={messages.operator.heading}>
        <Notice tone="warn">
          Текущая демо-роль не имеет доступа к кабинету оператора.
        </Notice>
      </Section>
    );
  }

  const queue = repo.demoModerationQueue(session);

  return (
    <div className="stack">
      <Section heading={messages.operator.heading} headingId="operator-heading">
        <Notice tone="warn">{messages.operator.readonlyNotice}</Notice>
      </Section>

      <Section heading={messages.operator.queue} headingId="operator-queue">
        <table className="table">
          <caption className="sr-only">Очередь демо-поставщиков</caption>
          <thead>
            <tr>
              <th scope="col">Поставщик</th>
              <th scope="col">Зоны</th>
              <th scope="col">Витрина</th>
              <th scope="col">Мин. заказ</th>
            </tr>
          </thead>
          <tbody>
            {queue.map((s) => (
              <tr key={s.id}>
                <td data-label="Поставщик">{s.displayName}</td>
                <td data-label="Зоны">{s.deliveryZones.join(", ")}</td>
                <td data-label="Витрина">
                  <StatusPill label="черновик (демо)" tone="neutral" />
                </td>
                <td data-label="Мин. заказ">
                  <MoneyText value={s.minimumOrderValue} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="muted small">
          Всего демо-предложений: {state.offers.length}. Оператор не редактирует цены и
          заказы.
        </p>
      </Section>
    </div>
  );
}
