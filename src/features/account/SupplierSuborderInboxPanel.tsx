import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  ErrorState,
  LoadingState,
  Notice,
  Section,
  StatusPill,
} from "@/components/primitives";
import type {
  SupplierSuborderWorkflow,
  SupplierSuborderWorkflowReceipt,
} from "@/domain/supplierSuborderWorkflow";
import type { MembershipRole, OrganizationType } from "@/data/supabase/database.types";
import type { WorkspaceClient } from "@/data/supabase/workspace";
import {
  supplierSuborderInboxAdapter,
  type SupplierSuborderInboxAdapter,
} from "@/data/supabase/supplierSuborderInboxAdapter";
import {
  canAccessSupplierSuborderInbox,
  isSupplierSuborderStaleConflict,
  newSupplierSuborderIdempotencyKey,
  supplierSuborderClientErrorMessage,
  SUPPLIER_SUBORDER_STATUS_LABELS,
  type SupplierSuborderProposalDraftLine,
} from "@/data/supabase/supplierSuborders";

type InboxRows = {
  readonly organizationId: string;
  readonly rows: readonly SupplierSuborderWorkflow[];
};
type ProposalFormLine = {
  readonly buyerRequestLineId: string;
  readonly quantity: string;
  readonly priceAmount: string;
};
type ActionMode = "details" | "reject" | "propose";

export function SupplierSuborderInboxPanel({
  client,
  organizationId,
  organizationType,
  role,
  adapter = supplierSuborderInboxAdapter,
}: {
  readonly client: WorkspaceClient;
  readonly organizationId: string;
  readonly organizationType: OrganizationType;
  readonly role: MembershipRole;
  readonly adapter?: SupplierSuborderInboxAdapter;
}): ReactNode {
  const [data, setData] = useState<InboxRows>({ organizationId: "", rows: [] });
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [mode, setMode] = useState<ActionMode>("details");
  const [rejectReason, setRejectReason] = useState("");
  const [proposalReason, setProposalReason] = useState("");
  const [proposalDeadline, setProposalDeadline] = useState("");
  const [proposalLines, setProposalLines] = useState<readonly ProposalFormLine[]>([]);
  const dataRef = useRef(data);
  dataRef.current = data;

  const rows = data.organizationId === organizationId ? data.rows : [];
  const selected = rows.find((row) => row.supplierSuborderId === selectedId) ?? rows[0];
  const canUseInbox =
    organizationType === "supplier" && canAccessSupplierSuborderInbox(role);

  useEffect(() => {
    let active = true;
    const currentData = dataRef.current;
    const priorRows =
      currentData.organizationId === organizationId ? currentData.rows : [];
    if (currentData.organizationId !== organizationId) {
      setData({ organizationId, rows: [] });
      setSelectedId("");
      setActionMessage(null);
      setActionError(null);
      setStale(false);
    }
    setLoadError(null);
    setLoading(priorRows.length === 0);
    setRefreshing(priorRows.length > 0);

    if (!canUseInbox) {
      setLoading(false);
      setRefreshing(false);
      return () => {
        active = false;
      };
    }

    void adapter
      .list(client, { organizationId, organizationType, role })
      .then((nextRows) => {
        if (!active) return;
        setData({ organizationId, rows: nextRows });
        setSelectedId((current) =>
          nextRows.some((row) => row.supplierSuborderId === current)
            ? current
            : (nextRows[0]?.supplierSuborderId ?? ""),
        );
        setStale(false);
        setLoadError(null);
        setActionError(null);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(supplierSuborderClientErrorMessage(error));
        setStale(priorRows.length > 0);
      })
      .finally(() => {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      });

    return () => {
      active = false;
    };
  }, [adapter, canUseInbox, client, organizationId, organizationType, refreshKey, role]);

  useEffect(() => {
    setMode("details");
    setRejectReason("");
    setProposalReason("");
    setProposalDeadline("");
    setProposalLines(
      selected?.lines.map((line) => ({
        buyerRequestLineId: line.buyerRequestLineId,
        quantity: String(line.quantity),
        priceAmount: line.priceAmount,
      })) ?? [],
    );
  }, [selected?.lines, selected?.supplierSuborderId, selected?.workflowVersion]);

  async function runAction(
    action: () => Promise<SupplierSuborderWorkflowReceipt>,
    success: string,
  ) {
    setBusy(true);
    setActionError(null);
    setActionMessage(null);
    try {
      const receipt = await action();
      setActionMessage(
        `${success} Текущий статус: ${SUPPLIER_SUBORDER_STATUS_LABELS[receipt.status]}.`,
      );
      setMode("details");
      setRefreshKey((value) => value + 1);
    } catch (error: unknown) {
      setActionError(supplierSuborderClientErrorMessage(error));
      if (isSupplierSuborderStaleConflict(error)) setStale(true);
    } finally {
      setBusy(false);
    }
  }

  function submitReject(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selected) return;
    void runAction(
      () =>
        adapter.reject(
          client,
          { organizationId, organizationType, role },
          selected,
          rejectReason,
          newSupplierSuborderIdempotencyKey(),
        ),
      "Ответ поставщика записан.",
    );
  }

  function submitProposal(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!selected) return;
    const deadline = new Date(proposalDeadline);
    if (!proposalDeadline || !Number.isFinite(deadline.getTime())) {
      setActionError("Укажите корректный будущий срок ответа.");
      return;
    }
    const lines: SupplierSuborderProposalDraftLine[] = proposalLines.map((line) => ({
      buyerRequestLineId: line.buyerRequestLineId,
      quantity: Number(line.quantity),
      priceAmount: line.priceAmount.trim(),
    }));
    void runAction(
      () =>
        adapter.propose(
          client,
          { organizationId, organizationType, role },
          selected,
          proposalReason,
          deadline.toISOString(),
          lines,
          newSupplierSuborderIdempotencyKey(),
        ),
      "Новая версия условий передана на решение покупателю.",
    );
  }

  function updateProposalLine(
    buyerRequestLineId: string,
    key: "quantity" | "priceAmount",
    value: string,
  ): void {
    setProposalLines((current) =>
      current.map((line) =>
        line.buyerRequestLineId === buyerRequestLineId ? { ...line, [key]: value } : line,
      ),
    );
  }

  return (
    <Section
      heading="Входящие подзаказы поставщика"
      headingId="supplier-suborder-inbox-heading"
    >
      <p className="small muted">
        Показываются внутренние подзаказы только выбранной организации поставщика. Ответы
        фиксируют состояние условий; это не резерв, внешняя закупка, оплата или отправка
        сообщения.
      </p>

      {!canUseInbox ? (
        <Notice tone="warn">
          Просмотр и ответы доступны только организации-поставщику с ролью owner, admin
          или order_operator.
        </Notice>
      ) : null}

      {canUseInbox && loading ? (
        <LoadingState message="Загружаем собственные подзаказы…" />
      ) : null}
      {canUseInbox && refreshing ? (
        <p className="small muted" role="status" aria-live="polite">
          Обновляем список…
        </p>
      ) : null}
      {canUseInbox && stale ? (
        <Notice tone="warn">
          Показанные данные могли устареть. Действия отключены до успешного обновления
          списка.
        </Notice>
      ) : null}
      {canUseInbox && loadError ? (
        <div className="supplier-suborder-load-error">
          <ErrorState message={loadError} />
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={loading || refreshing}
          >
            Обновить список
          </button>
        </div>
      ) : null}
      {canUseInbox && actionError ? (
        <div className="supplier-suborder-action-error">
          <ErrorState message={actionError} />
          {stale ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setRefreshKey((value) => value + 1)}
              disabled={loading || refreshing}
            >
              Обновить список
            </button>
          ) : null}
        </div>
      ) : null}
      {canUseInbox && actionMessage ? (
        <p className="ok" role="status" aria-live="polite">
          {actionMessage}
        </p>
      ) : null}

      {canUseInbox && !loading && rows.length === 0 && !loadError ? (
        <p className="empty" role="status">
          Собственных входящих подзаказов пока нет.
        </p>
      ) : null}

      {canUseInbox && rows.length > 0 ? (
        <div className="supplier-suborder-inbox">
          <nav
            aria-label="Список собственных подзаказов"
            className="supplier-suborder-list"
          >
            <ul>
              {rows.map((workflow) => (
                <li key={workflow.supplierSuborderId}>
                  <button
                    type="button"
                    className={`supplier-suborder-list-item${selected?.supplierSuborderId === workflow.supplierSuborderId ? " is-selected" : ""}`}
                    aria-pressed={
                      selected?.supplierSuborderId === workflow.supplierSuborderId
                    }
                    onClick={() => setSelectedId(workflow.supplierSuborderId)}
                  >
                    <span className="supplier-suborder-list-id">
                      Подзаказ · {workflow.supplierSuborderId.slice(-8)}
                    </span>
                    <span className="small muted">
                      {SUPPLIER_SUBORDER_STATUS_LABELS[workflow.status]}
                    </span>
                    <span className="small muted">Версия {workflow.workflowVersion}</span>
                  </button>
                </li>
              ))}
            </ul>
          </nav>

          {selected ? (
            <article
              className="supplier-suborder-details"
              aria-labelledby="supplier-suborder-detail-title"
            >
              <header className="supplier-suborder-detail-heading">
                <div>
                  <h3 id="supplier-suborder-detail-title">
                    Подзаказ · {selected.supplierSuborderId.slice(-8)}
                  </h3>
                  <p className="small muted">
                    Обновлён {new Date(selected.updatedAt).toLocaleString("ru-RU")}
                  </p>
                </div>
                <StatusPill
                  label={SUPPLIER_SUBORDER_STATUS_LABELS[selected.status]}
                  tone={selected.status === "awaiting_supplier" ? "warn" : "info"}
                />
              </header>
              <p className="small muted">
                Версия workflow {selected.workflowVersion} · версия условий{" "}
                {selected.currentTermsVersion}
              </p>
              {selected.termsReason ? (
                <p className="small">
                  <strong>Причина версии условий:</strong> {selected.termsReason}
                </p>
              ) : null}
              {selected.responseDeadlineAt ? (
                <p className="small">
                  <strong>Срок ответа:</strong>{" "}
                  {new Date(selected.responseDeadlineAt).toLocaleString("ru-RU")}
                </p>
              ) : null}
              <ul className="supplier-suborder-lines">
                {selected.lines.map((line) => (
                  <li key={line.buyerRequestLineId}>
                    <strong>{line.title}</strong>
                    <span>
                      {line.quantity} × {line.sellUnitLabel} ({line.packAmount}{" "}
                      {line.packBaseUnit})
                    </span>
                    <span>
                      {line.priceAmount} {line.currency} за продаваемую единицу
                    </span>
                  </li>
                ))}
              </ul>

              {selected.status === "awaiting_supplier" ? (
                <div className="supplier-suborder-actions">
                  <div className="action-row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={busy || stale || refreshing}
                      onClick={() =>
                        void runAction(
                          () =>
                            adapter.accept(
                              client,
                              { organizationId, organizationType, role },
                              selected,
                              newSupplierSuborderIdempotencyKey(),
                            ),
                          "Условия приняты поставщиком.",
                        )
                      }
                    >
                      Принять условия
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy || stale || refreshing}
                      onClick={() =>
                        setMode((current) =>
                          current === "reject" ? "details" : "reject",
                        )
                      }
                    >
                      Отклонить с причиной
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      disabled={busy || stale || refreshing}
                      onClick={() =>
                        setMode((current) =>
                          current === "propose" ? "details" : "propose",
                        )
                      }
                    >
                      Предложить новую версию
                    </button>
                  </div>

                  {mode === "reject" ? (
                    <form className="supplier-suborder-form" onSubmit={submitReject}>
                      <label className="field" htmlFor="supplier-suborder-reject-reason">
                        Причина отклонения
                        <textarea
                          id="supplier-suborder-reject-reason"
                          required
                          minLength={1}
                          maxLength={1000}
                          rows={3}
                          value={rejectReason}
                          onChange={(event) => setRejectReason(event.target.value)}
                        />
                      </label>
                      <button
                        className="btn btn-primary"
                        type="submit"
                        disabled={busy || stale}
                      >
                        {busy ? "Сохраняем…" : "Отправить отказ"}
                      </button>
                    </form>
                  ) : null}

                  {mode === "propose" ? (
                    <form className="supplier-suborder-form" onSubmit={submitProposal}>
                      <label
                        className="field"
                        htmlFor="supplier-suborder-proposal-reason"
                      >
                        Почему предлагаются новые условия
                        <textarea
                          id="supplier-suborder-proposal-reason"
                          required
                          minLength={1}
                          maxLength={1000}
                          rows={3}
                          value={proposalReason}
                          onChange={(event) => setProposalReason(event.target.value)}
                        />
                      </label>
                      <label
                        className="field"
                        htmlFor="supplier-suborder-response-deadline"
                      >
                        Срок ответа покупателя
                        <input
                          id="supplier-suborder-response-deadline"
                          type="datetime-local"
                          required
                          value={proposalDeadline}
                          onChange={(event) => setProposalDeadline(event.target.value)}
                        />
                      </label>
                      <p className="small muted">
                        Предложение заменяет условия всех строк этой ветки. Цены вводятся
                        точно, без пересчёта валюты. Срок показывается, но автоматического
                        истечения или согласия нет.
                      </p>
                      <div className="supplier-suborder-proposal-lines">
                        {proposalLines.map((line, index) => {
                          const original = selected.lines.find(
                            (candidate) =>
                              candidate.buyerRequestLineId === line.buyerRequestLineId,
                          );
                          if (!original) return null;
                          return (
                            <fieldset
                              className="supplier-suborder-proposal-line"
                              key={line.buyerRequestLineId}
                            >
                              <legend>{original.title}</legend>
                              <label
                                className="field"
                                htmlFor={`supplier-suborder-quantity-${index}`}
                              >
                                Количество
                                <input
                                  id={`supplier-suborder-quantity-${index}`}
                                  type="number"
                                  min={1}
                                  max={1_000_000}
                                  step={1}
                                  required
                                  value={line.quantity}
                                  onChange={(event) =>
                                    updateProposalLine(
                                      line.buyerRequestLineId,
                                      "quantity",
                                      event.target.value,
                                    )
                                  }
                                />
                              </label>
                              <label
                                className="field"
                                htmlFor={`supplier-suborder-price-${index}`}
                              >
                                Цена ({original.currency})
                                <input
                                  id={`supplier-suborder-price-${index}`}
                                  type="text"
                                  inputMode="decimal"
                                  pattern="(?:0|[1-9][0-9]{0,11})(?:[.][0-9]{1,4})?"
                                  required
                                  value={line.priceAmount}
                                  onChange={(event) =>
                                    updateProposalLine(
                                      line.buyerRequestLineId,
                                      "priceAmount",
                                      event.target.value,
                                    )
                                  }
                                />
                              </label>
                            </fieldset>
                          );
                        })}
                      </div>
                      <button
                        className="btn btn-primary"
                        type="submit"
                        disabled={busy || stale}
                      >
                        {busy ? "Сохраняем…" : "Передать новую версию"}
                      </button>
                    </form>
                  ) : null}
                </div>
              ) : null}
            </article>
          ) : null}
        </div>
      ) : null}

      {canUseInbox && rows.length > 0 ? (
        <div className="supplier-suborder-refresh-row">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => setRefreshKey((value) => value + 1)}
            disabled={loading || refreshing || busy}
          >
            {refreshing ? "Обновляем…" : "Обновить подзаказы"}
          </button>
        </div>
      ) : null}
    </Section>
  );
}
