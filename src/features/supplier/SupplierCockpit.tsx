import { useMemo, useState, type ReactNode } from "react";
import { useApp } from "@/app/store";
import {
  EmptyState,
  MoneyText,
  Notice,
  Section,
  StatusPill,
} from "@/components/primitives";
import { describePackaging } from "@/components/format";
import {
  FULFILLMENT_STATUS_LABELS,
  SUBORDER_STATUS_LABELS,
} from "@/domain/orderLifecycle";
import { canEditSupplierCatalog, canRespondToSuborder } from "@/domain/authorization";
import {
  CSV_TEMPLATE,
  parseCatalogCsv,
  resolveImportRows,
  type ExistingOfferSnapshot,
  type ResolvedImport,
} from "@/domain/catalogImport";
import { toSafeError } from "@/domain/errors";
import type { SupplierOffer, SupplierSuborder } from "@/domain/entities";
import type { AvailabilityStatus } from "@/domain/freshness";
import type { RevisionLineInput } from "@/domain/revisions";

function OfferEditor({ offer }: { offer: SupplierOffer }): ReactNode {
  const { repo, session, messages } = useApp();
  const [price, setPrice] = useState<string>(
    offer.pricePerSellUnit.value ? String(offer.pricePerSellUnit.value.amount) : "",
  );
  const [availability, setAvailability] = useState<AvailabilityStatus | "">(
    offer.availability.value ?? "",
  );
  const [msg, setMsg] = useState<string | null>(null);

  const canEdit = canEditSupplierCatalog(session.membership, offer.supplierId);

  return (
    <article className="offer-editor">
      <header>
        <h4>{offer.title}</h4>
        <p className="muted small">
          SKU {offer.supplierSku} · версия {offer.version} · {describePackaging(offer)}
        </p>
      </header>
      {!canEdit ? (
        <p className="muted small">Ваша демо-роль не может редактировать каталог.</p>
      ) : (
        <div className="offer-editor-controls">
          <label className="field">
            <span>{messages.supplier.updatePrice}</span>
            <input
              type="number"
              min={1}
              step={1}
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="field">
            <span>{messages.supplier.updateAvailability}</span>
            <select
              value={availability}
              onChange={(e) => setAvailability(e.target.value as AvailabilityStatus | "")}
            >
              <option value="">— не указано —</option>
              <option value="in_stock">В наличии</option>
              <option value="low_stock">Мало</option>
              <option value="out_of_stock">Нет в наличии</option>
              <option value="on_request">Под заказ</option>
            </select>
          </label>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              try {
                const n = Number(price);
                if (!Number.isInteger(n) || n <= 0)
                  throw new Error("Цена должна быть целым положительным числом тенге.");
                repo.updateOfferPrice(session, offer.id, n, offer.version);
                setMsg("Цена обновлена (демо). Временная метка обновлена.");
              } catch (e) {
                setMsg(toSafeError(e).message);
              }
            }}
          >
            Сохранить цену
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => {
              try {
                repo.updateOfferAvailability(
                  session,
                  offer.id,
                  availability === "" ? null : availability,
                  offer.version,
                );
                setMsg("Наличие обновлено (демо).");
              } catch (e) {
                setMsg(toSafeError(e).message);
              }
            }}
          >
            Сохранить наличие
          </button>
        </div>
      )}
      {msg ? (
        <p className="info small" role="status" aria-live="polite">
          {msg}
        </p>
      ) : null}
    </article>
  );
}

function SuborderResponder({ suborder }: { suborder: SupplierSuborder }): ReactNode {
  const { state, repo, session, messages } = useApp();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canRespond = canRespondToSuborder(session.membership, suborder.supplierId);
  const parent = state.suborders.find((s) => s.id === suborder.id);
  const revision = state.revisions.find((r) => r.id === suborder.currentRevisionId);

  function guard(fn: () => void): void {
    setBusy(true);
    setError(null);
    try {
      fn();
    } catch (e) {
      setError(toSafeError(e).message);
    } finally {
      setBusy(false);
    }
  }

  function proposePriceChange(): void {
    if (!revision) return;
    guard(() => {
      const lines: RevisionLineInput[] = revision.lines.map((l) => {
        const offer = state.offers.find((o) => o.id === l.offerId);
        const before = l.priceAfter ?? l.priceBefore;
        const after = before
          ? { amount: before.amount + 100, currency: before.currency }
          : null;
        return {
          offerId: l.offerId,
          changeKind: before && after ? "price_changed" : "unchanged",
          quantityBefore: l.quantityAfter ?? l.quantityBefore,
          quantityAfter: l.quantityAfter ?? l.quantityBefore,
          priceBefore: before,
          priceAfter: after,
          sellUnitLabelBefore: offer?.packaging.sellUnit.label ?? null,
          sellUnitLabelAfter: offer?.packaging.sellUnit.label ?? null,
          substitutedFromOfferId: null,
          substitutedToOfferId: null,
          reasonDemo: "Изменение цены поставщиком (демо, +100 ₸)",
        };
      });
      repo.proposeChange(session, suborder.id, lines, null, suborder.version);
    });
  }

  return (
    <li className="suborder-item">
      <div>
        <strong>{suborder.id}</strong>
        <div className="pill-row">
          <StatusPill
            label={`Согласование: ${SUBORDER_STATUS_LABELS[suborder.status]}`}
            tone={suborder.status === "awaiting_supplier" ? "warn" : "info"}
          />
          <StatusPill
            label={`Исполнение: ${FULFILLMENT_STATUS_LABELS[suborder.fulfillmentStatus]}`}
            tone="neutral"
          />
        </div>
        <p className="muted small">
          Версия {suborder.version} ·{" "}
          {parent?.confirmedLines ? "подтверждён" : "не подтверждён"}
        </p>
      </div>
      {canRespond ? (
        <div className="action-row">
          {suborder.status === "awaiting_supplier" && revision ? (
            <>
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() =>
                  guard(() =>
                    repo.confirmSuborderNoChange(session, suborder.id, suborder.version),
                  )
                }
              >
                {messages.supplier.confirmNoChange}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={proposePriceChange}
              >
                {messages.supplier.proposeChange}
              </button>
            </>
          ) : null}
          {suborder.status === "confirmed" ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() =>
                guard(() =>
                  repo.advanceFulfillment(
                    session,
                    suborder.id,
                    "packing",
                    suborder.version,
                  ),
                )
              }
            >
              Начать сборку
            </button>
          ) : null}
          {suborder.fulfillmentStatus === "packing" ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() =>
                guard(() =>
                  repo.advanceFulfillment(
                    session,
                    suborder.id,
                    "ready_for_handover",
                    suborder.version,
                  ),
                )
              }
            >
              Готово к передаче
            </button>
          ) : null}
          {suborder.fulfillmentStatus === "ready_for_handover" ? (
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() =>
                guard(() =>
                  repo.advanceFulfillment(
                    session,
                    suborder.id,
                    "shipped",
                    suborder.version,
                  ),
                )
              }
            >
              Отгрузить
            </button>
          ) : null}
          {error ? (
            <p className="error small" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="muted small">Ваша демо-роль не может отвечать на подзаказы.</p>
      )}
    </li>
  );
}

function ImportPanel(): ReactNode {
  const { state, repo, session, messages } = useApp();
  const [text, setText] = useState(CSV_TEMPLATE);
  const [result, setResult] = useState<ResolvedImport | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const supplierId = session.membership.supplierId;
  const canImport =
    supplierId !== null && canEditSupplierCatalog(session.membership, supplierId);

  if (!canImport || supplierId === null) {
    return (
      <Notice tone="info">
        Импорт CSV доступен только демо-роли с правом редактирования каталога.
      </Notice>
    );
  }

  // Existing offers for THIS supplier, so the preview can show before/after and
  // detect duplicates rather than creating them.
  const existingSnapshots: ExistingOfferSnapshot[] = state.offers
    .filter((o) => o.supplierId === supplierId)
    .map((o) => ({
      sku: o.supplierSku,
      title: o.title,
      pricePerSellUnit: o.pricePerSellUnit.value?.amount ?? null,
      moq: o.packaging.moq,
      orderStep: o.packaging.orderStep,
    }));

  function runPreview(): void {
    setApplied(null);
    setError(null);
    const parsed = parseCatalogCsv(text, {
      existingSkus: existingSnapshots.map((o) => o.sku),
    });
    setResult(resolveImportRows(parsed, existingSnapshots));
  }

  return (
    <div className="import-panel">
      <Notice tone="info">
        Импорт выполняется локально, ничего не отправляется. Подозрительные значения
        отклоняются, а не исправляются автоматически. Формулы обезвреживаются, макросы не
        исполняются. Применение атомарное: при любой ошибке не записывается ничего.
      </Notice>
      <label className="field">
        <span>CSV (шаблон уже заполнен демо-строкой)</span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="csv-input"
          spellCheck={false}
        />
      </label>
      <div className="action-row">
        <button type="button" className="btn btn-ghost" onClick={runPreview}>
          Предпросмотр и проверка
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={
            !result ||
            result.summary.errors > 0 ||
            result.summary.added + result.summary.updated === 0
          }
          onClick={() => {
            if (!result || supplierId === null) return;
            try {
              const { jobId } = repo.applyCatalogImport(
                { ...session, idempotencyKey: `import-${supplierId}-${session.nowIso}` },
                supplierId,
                result.resolved,
                {
                  added: result.summary.added,
                  updated: result.summary.updated,
                  errors: result.summary.errors,
                  skipped: result.summary.skipped,
                },
                result.rows.map((r) => ({
                  rowNumber: r.rowNumber,
                  status: r.status === "unchanged" ? "skipped" : r.status,
                  errors: r.errors,
                  sku: r.sku,
                })),
              );
              setApplied(jobId);
            } catch (e) {
              setError(toSafeError(e).message);
            }
          }}
          title={
            result && result.summary.errors > 0
              ? "Сначала исправьте ошибки"
              : result && result.summary.added + result.summary.updated === 0
                ? "Нет изменений для применения"
                : undefined
          }
        >
          {messages.supplier.importCsv}: применить
        </button>
      </div>

      {result ? (
        <div>
          <p aria-live="polite">
            Добавлено: {result.summary.added} · Изменено: {result.summary.updated} · Без
            изменений: {result.summary.unchanged} · Ошибок: {result.summary.errors} ·
            Пропущено: {result.summary.skipped}
          </p>
          <table className="table">
            <caption className="sr-only">Результат проверки CSV</caption>
            <thead>
              <tr>
                <th scope="col">Строка</th>
                <th scope="col">SKU</th>
                <th scope="col">Статус</th>
                <th scope="col">Изменения</th>
                <th scope="col">Ошибки</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.rowNumber}>
                  <td data-label="Строка">{r.rowNumber}</td>
                  <td data-label="SKU">{r.sku ?? "—"}</td>
                  <td data-label="Статус">{r.status}</td>
                  <td data-label="Изменения">{r.changes.join("; ") || "—"}</td>
                  <td data-label="Ошибки">{r.errors.join("; ") || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {applied ? (
        <p className="ok" role="status">
          Демо-импорт применён локально (задание {applied}). Повторный импорт того же
          файла не создаёт дублей. Данные живут только в этой сессии.
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SupplierCockpit(): ReactNode {
  const { state, session, messages } = useApp();
  const supplierId = session.membership.supplierId;

  const myOffers = useMemo(
    () => state.offers.filter((o) => o.supplierId === supplierId),
    [state.offers, supplierId],
  );

  const mySuborders = useMemo(
    () =>
      state.suborders.filter((s) =>
        supplierId !== null ? s.supplierId === supplierId : false,
      ),
    [state.suborders, supplierId],
  );

  if (supplierId === null) {
    return (
      <Section heading={messages.supplier.heading}>
        <Notice tone="info">
          Текущая демо-роль не является поставщиком. Переключите демо-роль на поставщика.
        </Notice>
      </Section>
    );
  }

  const supplier = state.suppliers.find((s) => s.id === supplierId);

  return (
    <div className="stack">
      <Section heading={messages.supplier.heading} headingId="supplier-heading">
        <Notice tone="demo">{messages.supplier.draftStorefront}</Notice>
        <p className="muted small">
          {supplier?.displayName} · зоны: {supplier?.deliveryZones.join(", ")} ·{" "}
          {messages.common.minimumOrderValue}:{" "}
          <MoneyText value={supplier?.minimumOrderValue ?? null} />
        </p>
      </Section>

      <Section
        heading={messages.supplier.incomingSuborders}
        headingId="supplier-suborders"
      >
        {mySuborders.length === 0 ? (
          <EmptyState message="Входящих демо-подзаказов нет. Отправьте корзину под ролью покупателя." />
        ) : (
          <ul className="suborder-list">
            {mySuborders.map((s) => (
              <SuborderResponder key={s.id} suborder={s} />
            ))}
          </ul>
        )}
      </Section>

      <Section heading={messages.supplier.myOffers} headingId="supplier-offers">
        <ul className="offer-editor-list">
          {myOffers.map((o) => (
            <li key={o.id}>
              <OfferEditor offer={o} />
            </li>
          ))}
        </ul>
      </Section>

      <Section heading={messages.supplier.importCsv} headingId="supplier-import">
        <ImportPanel />
      </Section>
    </div>
  );
}
