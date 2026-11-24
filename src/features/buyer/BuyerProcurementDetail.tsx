import { useState, type ReactNode } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { useApp } from "@/app/store";
import {
  EmptyState,
  MoneyText,
  Notice,
  Section,
  StatusPill,
} from "@/components/primitives";
import {
  FULFILLMENT_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  SUBORDER_STATUS_LABELS,
} from "@/domain/orderLifecycle";
import { describeRevisionLine } from "@/domain/revisions";
import {
  canCancelSuborder,
  canManageProcurement,
  canRecordReceiving,
} from "@/domain/authorization";
import { describeFlaggedReason } from "@/domain/reorder";
import { toSafeError } from "@/domain/errors";
import type { DiscrepancyReason, SupplierSuborder } from "@/domain/entities";

const DISCREPANCY_LABELS: Record<DiscrepancyReason, string> = {
  shortage: "Недостача",
  wrong_item: "Неверная позиция",
  unapproved_substitution: "Несогласованная замена",
  damaged: "Повреждение",
  expired: "Просрочка",
  temperature: "Проблема температуры",
  delay: "Задержка",
};

function ReceivingForm({ suborder }: { suborder: SupplierSuborder }): ReactNode {
  const { repo, session } = useApp();
  const [received, setReceived] = useState<Record<string, number>>({});
  const [reasons, setReasons] = useState<DiscrepancyReason[]>([]);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = suborder.confirmedLines ?? [];

  if (done) {
    return (
      <p className="ok" role="status">
        Приёмка записана (демо). Это наблюдение, а не решение спора.
      </p>
    );
  }

  return (
    <form
      className="receiving-form"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        try {
          repo.recordReceipt(
            session,
            suborder.id,
            lines.map((l) => ({
              offerId: l.offerId,
              expectedQuantity: l.quantity,
              receivedQuantity: received[l.offerId] ?? l.quantity,
            })),
            reasons,
            suborder.version,
          );
          setDone(true);
        } catch (err) {
          setError(toSafeError(err).message);
        }
      }}
    >
      <table className="table">
        <caption className="sr-only">Приёмка</caption>
        <thead>
          <tr>
            <th scope="col">Позиция</th>
            <th scope="col">Ожидалось</th>
            <th scope="col">Получено</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={l.offerId}>
              <td data-label="Позиция">{l.title}</td>
              <td data-label="Ожидалось">{l.quantity}</td>
              <td data-label="Получено">
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={received[l.offerId] ?? l.quantity}
                  onChange={(e) =>
                    setReceived((r) => ({ ...r, [l.offerId]: Number(e.target.value) }))
                  }
                  aria-label={`Получено: ${l.title}`}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <fieldset className="fieldset">
        <legend>Отмеченные расхождения (демо)</legend>
        {Object.entries(DISCREPANCY_LABELS).map(([key, label]) => (
          <label key={key} className="field field-checkbox">
            <input
              type="checkbox"
              checked={reasons.includes(key as DiscrepancyReason)}
              onChange={(e) =>
                setReasons((r) =>
                  e.target.checked
                    ? [...r, key as DiscrepancyReason]
                    : r.filter((x) => x !== key),
                )
              }
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>

      <p className="muted small">
        Приёмка фиксирует наблюдение. Она не решает спор, не обещает возврат или
        компенсацию.
      </p>
      {error ? (
        <p className="error small" role="alert">
          {error}
        </p>
      ) : null}
      <button type="submit" className="btn btn-primary">
        Записать приёмку (демо)
      </button>
    </form>
  );
}

export function BuyerProcurementDetail(): ReactNode {
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const selectedSubId = search.get("sub");
  const { state, repo, session, membership, messages } = useApp();
  const [reorderMessage, setReorderMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Tenant-scoped: only suborders this membership may see inside this parent.
  // A guessed/foreign id yields an empty list and a safe not-found message.
  const suborders = id ? repo.visibleSubordersOf(session, id) : [];

  const parent = id ? repo.getVisibleParent(session, id) : undefined;

  const active = suborders.find((s) => s.id === selectedSubId) ?? suborders[0] ?? null;

  if (!id || suborders.length === 0 || !parent || !active) {
    return (
      <Section heading={messages.procurement.heading}>
        <EmptyState message="Закупка не найдена или недоступна (демо)." />
        <Link className="btn btn-ghost" to="/procurement">
          {messages.common.back}
        </Link>
      </Section>
    );
  }

  const activeSub = active;
  const supplier = state.suppliers.find((s) => s.id === activeSub.supplierId);
  const location = state.buyerLocations.find((l) => l.id === activeSub.locationId);
  const currentRevision = state.revisions.find(
    (r) => r.id === activeSub.currentRevisionId,
  );
  const decisions = state.decisions.filter((d) => d.suborderId === activeSub.id);
  const receiptDone = state.receipts.some((r) => r.suborderId === activeSub.id);
  const canDecide = canManageProcurement(membership, activeSub.orgId);
  // The buyer may cancel a branch that is not already in a terminal outcome.
  const cancellable =
    canCancelSuborder(membership, activeSub) &&
    activeSub.status !== "cancelled" &&
    activeSub.status !== "rejected" &&
    activeSub.status !== "expired";

  function handleCancelBranch(): void {
    setError(null);
    try {
      repo.cancelSuborder(
        session,
        activeSub.id,
        "Отменено покупателем (демо)",
        activeSub.version,
      );
    } catch (e) {
      setError(toSafeError(e).message);
    }
  }

  function handleReorder(): void {
    setError(null);
    try {
      // Persist a NEW editable draft in the buyer's basket and re-check live
      // terms. Missing/archived/unpriced items become an explicit decision list.
      const { draft, replayed } = repo.reorderIntoBasket(
        { ...session, idempotencyKey: `reorder-${activeSub.id}-${session.nowIso}` },
        activeSub.id,
      );
      if (replayed) {
        setReorderMessage("Черновик повтора уже создан. Откройте корзину.");
        return;
      }
      if (draft.summary.flagged > 0) {
        const reasons = draft.flagged
          .filter(
            (f): f is Extract<typeof f, { kind: "flagged" }> => f.kind === "flagged",
          )
          .map((f) => describeFlaggedReason(f.reason));
        setReorderMessage(
          `Черновик создан: перенесено ${draft.summary.carried}. Требуют решения: ${draft.summary.flagged}. ${reasons.join(" ")}`,
        );
      } else {
        setReorderMessage(
          `Черновик создан из ${draft.summary.carried} позиций. Цена и наличие будут перепроверены в корзине. Старые условия не воспроизводятся автоматически.`,
        );
      }
    } catch (e) {
      setError(toSafeError(e).message);
    }
  }

  function handleDecide(outcome: "accepted" | "rejected"): void {
    setError(null);
    try {
      repo.buyerDecide(
        session,
        activeSub.id,
        outcome,
        outcome === "rejected" ? "Отклонено в демо" : null,
        activeSub.version,
      );
    } catch (e) {
      setError(toSafeError(e).message);
    }
  }

  return (
    <div className="stack">
      <Section
        heading={`${supplier?.displayName ?? "—"} · подзаказ`}
        headingId="suborder-heading"
      >
        <Notice tone="warn">
          Это не единый договор, счёт или доставка. Одна родительская закупка содержит
          независимые подзаказы: {parent.suborderIds.length}.
        </Notice>
        <p className="muted small">
          Точка доставки: <strong>{location?.name ?? "не выбрана (демо)"}</strong>
          {location ? ` · зона ${location.deliveryZone}` : ""}. Продавец:{" "}
          {supplier?.displayName ?? "—"}.
        </p>
        <div className="pill-row">
          <StatusPill
            label={`${messages.statuses.agreement}: ${SUBORDER_STATUS_LABELS[activeSub.status]}`}
            tone="warn"
          />
          <StatusPill
            label={`${messages.statuses.fulfillment}: ${FULFILLMENT_STATUS_LABELS[activeSub.fulfillmentStatus]}`}
            tone="neutral"
          />
          <StatusPill
            label={`${messages.statuses.payment}: ${PAYMENT_STATUS_LABELS[activeSub.paymentStatus]}`}
            tone="neutral"
          />
        </div>
        <p className="muted small">Версия подзаказа: {activeSub.version}.</p>

        {currentRevision && currentRevision.lines.length > 0 ? (
          <details open className="revision">
            <summary>
              {currentRevision.author.kind === "supplier"
                ? `Предложение поставщика №${currentRevision.revisionNumber}`
                : "Исходный запрос покупателя"}
            </summary>
            <table className="table">
              <caption className="sr-only">
                {messages.procurement.proposalWasBecame}
              </caption>
              <thead>
                <tr>
                  <th scope="col">Позиция</th>
                  <th scope="col">Изменение</th>
                  <th scope="col">Причина</th>
                </tr>
              </thead>
              <tbody>
                {currentRevision.lines.map((l) => (
                  <tr key={l.id}>
                    <td data-label="Позиция">
                      {state.offers.find((o) => o.id === l.offerId)?.title ?? "Позиция"}
                    </td>
                    <td data-label="Изменение">{describeRevisionLine(l)}</td>
                    <td data-label="Причина">{l.reasonDemo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        ) : null}

        {activeSub.status === "awaiting_buyer_decision" ? (
          <Notice tone="warn">
            Поставщик предложил изменение. Оно НЕ применяется автоматически. Примите или
            отклоните именно эту версию.
          </Notice>
        ) : null}

        {activeSub.status === "awaiting_buyer_decision" && canDecide ? (
          <div className="decision-bar">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => handleDecide("accepted")}
            >
              {messages.procurement.accept}
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => handleDecide("rejected")}
            >
              {messages.procurement.reject}
            </button>
          </div>
        ) : null}

        {activeSub.confirmedLines ? (
          <div>
            <h3>{messages.procurement.confirmedVersion}</h3>
            <table className="table">
              <caption className="sr-only">Подтверждённые позиции</caption>
              <thead>
                <tr>
                  <th scope="col">Позиция</th>
                  <th scope="col">Кол-во</th>
                  <th scope="col">Цена</th>
                </tr>
              </thead>
              <tbody>
                {activeSub.confirmedLines.map((l) => (
                  <tr key={l.id}>
                    <td data-label="Позиция">{l.title}</td>
                    <td data-label="Кол-во">{l.quantity}</td>
                    <td data-label="Цена">
                      <MoneyText value={l.pricePerSellUnit} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {decisions.length > 0 ? (
          <ul className="decision-log">
            {decisions.map((d) => (
              <li key={d.id}>
                {messages.procurement.decisionRecorded}:{" "}
                {d.outcome === "accepted" ? "принято" : "отклонено"} (ревизия) ·{" "}
                {new Date(d.decidedAt).toLocaleString("ru-KZ")}
                {d.noteDemo ? ` · ${d.noteDemo}` : ""}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="action-row">
          <button type="button" className="btn btn-ghost" onClick={handleReorder}>
            {messages.procurement.reorder}
          </button>
          {cancellable ? (
            <button type="button" className="btn btn-ghost" onClick={handleCancelBranch}>
              Отменить этот подзаказ
            </button>
          ) : null}
        </div>
        {cancellable ? (
          <p className="muted small">
            Отмена затрагивает только этот подзаказ. Соседние подзаказы поставщиков не
            меняются; это не отмена всей закупки.
          </p>
        ) : null}
        {reorderMessage ? (
          <p className="info small" role="status" aria-live="polite">
            {reorderMessage}
          </p>
        ) : null}
        {error ? (
          <p className="error small" role="alert">
            {error}
          </p>
        ) : null}
      </Section>

      <Section heading={messages.statuses.fulfillment} headingId="fulfillment-heading">
        <p className="muted small">
          Исполнение — отдельное измерение. Оплата в прототипе не обрабатывается.
        </p>
        <StatusPill
          label={FULFILLMENT_STATUS_LABELS[activeSub.fulfillmentStatus]}
          tone="neutral"
        />
        {activeSub.fulfillmentStatus === "receiving" &&
        canRecordReceiving(membership, activeSub.orgId) &&
        !receiptDone ? (
          <ReceivingForm suborder={activeSub} />
        ) : null}
        {receiptDone ? <p className="ok small">Приёмка уже записана (демо).</p> : null}
      </Section>

      <Section heading={messages.procurement.subordersLabel} headingId="siblings-heading">
        <ul className="suborder-list">
          {suborders.map((s) => (
            <li key={s.id} className="suborder-item">
              <span>
                {state.suppliers.find((x) => x.id === s.supplierId)?.displayName} ·{" "}
                {SUBORDER_STATUS_LABELS[s.status]}
              </span>
              <Link className="btn btn-ghost" to={`/procurement/${id}?sub=${s.id}`}>
                {messages.procurement.open}
              </Link>
            </li>
          ))}
        </ul>
        <p className="muted small">Изменение одного подзаказа не влияет на остальные.</p>
      </Section>
    </div>
  );
}
