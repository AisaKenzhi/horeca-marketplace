import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { ErrorState, Notice, StatusPill } from "@/components/primitives";
import type { MembershipRole, OrganizationType } from "@/data/supabase/database.types";
import {
  buyerTermsAdapter,
  buyerTermsClientErrorMessage,
  canDecideBuyerTerms,
  canReadBuyerTerms,
  newBuyerTermsIdempotencyKey,
  type BuyerTermsAdapter,
} from "@/data/supabase/buyerSuborderTerms";
import {
  isSupplierSuborderStaleConflict,
  SUPPLIER_SUBORDER_STATUS_LABELS,
} from "@/data/supabase/supplierSuborders";
import {
  loadBuyerProcurementRequests,
  workspaceErrorMessage,
  type WorkspaceClient,
} from "@/data/supabase/workspace";
import {
  hasResponseDeadlineElapsed,
  SUPPLIER_RESPONSE_DEADLINE_NOTICE,
  type SupplierSuborderWorkflow,
} from "@/domain/supplierSuborderWorkflow";

type RequestRow = {
  readonly id: string;
  readonly source_list_name: string;
  readonly request_status: string;
};

export function BuyerTermsReviewPanel({
  client,
  organizationId,
  organizationType,
  role,
  adapter = buyerTermsAdapter,
}: {
  readonly client: WorkspaceClient;
  readonly organizationId: string;
  readonly organizationType: OrganizationType;
  readonly role: MembershipRole;
  readonly adapter?: BuyerTermsAdapter;
}): ReactNode {
  const [requests, setRequests] = useState<readonly RequestRow[]>([]);
  const [requestId, setRequestId] = useState("");
  const [rows, setRows] = useState<readonly SupplierSuborderWorkflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [actionMessage, setActionMessage] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [stale, setStale] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const keysRef = useRef(new Map<string, string>());
  const inFlightRef = useRef(false);

  const canRead = organizationType === "buyer" && canReadBuyerTerms(role);
  const canDecide = canRead && canDecideBuyerTerms(role);

  useEffect(() => {
    let active = true;
    setLoadError("");
    if (!canRead) {
      setLoading(false);
      return () => {
        active = false;
      };
    }
    setLoading(requests.length === 0);
    setRefreshing(requests.length > 0);
    void loadBuyerProcurementRequests(client, organizationId, role)
      .then((loaded) => {
        if (!active) return;
        const mapped: readonly RequestRow[] = loaded.map((request) => ({
          id: request.id,
          source_list_name: request.source_list_name,
          request_status: request.request_status,
        }));
        setRequests(mapped);
        setRequestId((current) =>
          mapped.some((request) => request.id === current)
            ? current
            : (mapped[0]?.id ?? ""),
        );
      })
      .catch((error: unknown) => {
        if (active) setLoadError(workspaceErrorMessage(error));
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
  }, [canRead, client, organizationId, requests.length, role, refreshKey]);

  useEffect(() => {
    let active = true;
    setRows([]);
    setStale(false);
    setRejectReason("");
    if (!canRead || !requestId)
      return () => {
        active = false;
      };
    void adapter
      .list(client, { organizationId, organizationType, role }, requestId)
      .then((loaded) => {
        if (active) setRows(loaded);
      })
      .catch((error: unknown) => {
        if (active) setLoadError(buyerTermsClientErrorMessage(error));
      });
    return () => {
      active = false;
    };
  }, [
    adapter,
    canRead,
    client,
    organizationId,
    organizationType,
    requestId,
    role,
    refreshKey,
  ]);

  function actionKey(workflow: SupplierSuborderWorkflow, action: string): string {
    const signature = JSON.stringify([
      organizationId,
      requestId,
      workflow.supplierSuborderId,
      workflow.workflowVersion,
      workflow.currentTermsVersion,
      action,
    ]);
    let key = keysRef.current.get(signature);
    if (!key) {
      key = newBuyerTermsIdempotencyKey();
      keysRef.current.set(signature, key);
    }
    return signature;
  }

  async function decide(
    workflow: SupplierSuborderWorkflow,
    action: "accept" | "reject",
  ): Promise<void> {
    if (!canDecide || inFlightRef.current || busy) return;
    const signature = actionKey(workflow, action);
    const key = keysRef.current.get(signature);
    if (!key) return;
    const reason = rejectReason.trim();
    inFlightRef.current = true;
    setBusy(true);
    setActionError("");
    setActionMessage("");
    try {
      const decision = {
        workflow,
        termsVersion: workflow.currentTermsVersion,
        reason: action === "reject" ? reason : "",
        idempotencyKey: key,
      };
      const receipt =
        action === "accept"
          ? await adapter.accept(
              client,
              { organizationId, organizationType, role },
              decision,
            )
          : await adapter.reject(
              client,
              { organizationId, organizationType, role },
              decision,
            );
      keysRef.current.delete(signature);
      setActionMessage(
        `Решение записано: ${SUPPLIER_SUBORDER_STATUS_LABELS[receipt.status]}. Это не подтверждённая закупка, оплата, резерв или доставка.`,
      );
      setRejectReason("");
      setRefreshKey((value) => value + 1);
    } catch (error: unknown) {
      setActionError(buyerTermsClientErrorMessage(error));
      if (isSupplierSuborderStaleConflict(error)) setStale(true);
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }

  if (!canRead) return null;

  return (
    <section
      className="card account-section buyer-terms-review"
      aria-labelledby="buyer-terms-review-title"
    >
      <h2 id="buyer-terms-review-title" className="card-title">
        Предложенные условия по вашим запросам
      </h2>
      <p className="small muted">
        Покупатель видит только свои запросы. Решение относится к точной версии условий
        поставщика; молчание не означает согласия. Принятие условий не создаёт заказ,
        резерв, оплату или доставку.
      </p>
      {!canDecide ? <Notice>Ваша роль доступна только для чтения.</Notice> : null}
      {loadError ? <ErrorState message={loadError} /> : null}
      {loading ? (
        <p className="loading" role="status">
          Загружаем запросы…
        </p>
      ) : null}
      {!loading && requests.length === 0 && !loadError ? (
        <p className="empty" role="status">
          Запросов закупки пока нет.
        </p>
      ) : null}
      {requests.length > 0 ? (
        <label className="field" htmlFor="buyer-terms-request">
          Запрос закупки
          <select
            id="buyer-terms-request"
            value={requestId}
            disabled={refreshing || busy}
            onChange={(event) => {
              setRequestId(event.target.value);
              setActionError("");
              setActionMessage("");
              setStale(false);
            }}
          >
            {requests.map((request) => (
              <option key={request.id} value={request.id}>
                {request.source_list_name} · {request.request_status}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {actionError ? <ErrorState message={actionError} /> : null}
      {stale ? (
        <div className="action-row">
          <Notice tone="warn">Условия изменились или версия устарела.</Notice>
          <button
            className="btn btn-ghost"
            type="button"
            disabled={busy || refreshing}
            onClick={() => setRefreshKey((value) => value + 1)}
          >
            Обновить список
          </button>
        </div>
      ) : null}
      {actionMessage ? (
        <p className="ok" role="status" aria-live="polite">
          {actionMessage}
        </p>
      ) : null}
      {requestId && rows.length === 0 && !loadError ? (
        <p className="empty" role="status">
          Адресованных вам предложений по этому запросу пока нет.
        </p>
      ) : null}
      {rows.map((workflow) => {
        const awaiting = workflow.status === "awaiting_buyer_decision";
        return (
          <article
            key={workflow.supplierSuborderId}
            className="supplier-suborder-details buyer-terms-card"
            aria-labelledby={`buyer-terms-${workflow.supplierSuborderId}`}
          >
            <header className="supplier-suborder-detail-heading">
              <h3 id={`buyer-terms-${workflow.supplierSuborderId}`}>
                Ветка поставщика · {workflow.supplierSuborderId.slice(-8)}
              </h3>
              <StatusPill
                label={SUPPLIER_SUBORDER_STATUS_LABELS[workflow.status]}
                tone={awaiting ? "warn" : "info"}
              />
            </header>
            <p className="small muted">
              workflow v{workflow.workflowVersion} · условия v
              {workflow.currentTermsVersion}
            </p>
            {workflow.termsReason ? (
              <p className="small">
                <strong>Причина предложения:</strong> {workflow.termsReason}
              </p>
            ) : null}
            {workflow.responseDeadlineAt ? (
              <p className="small">
                <strong>Срок ответа:</strong>{" "}
                {new Date(workflow.responseDeadlineAt).toLocaleString("ru-RU")}
                {hasResponseDeadlineElapsed(
                  workflow.responseDeadlineAt,
                  new Date().toISOString(),
                )
                  ? " (срок прошел)"
                  : ""}
              </p>
            ) : null}
            {workflow.responseDeadlineAt ? (
              <p className="small muted">{SUPPLIER_RESPONSE_DEADLINE_NOTICE}</p>
            ) : null}
            <ul className="supplier-suborder-lines">
              {workflow.lines.map((line) => (
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
            {awaiting && canDecide ? (
              <form
                className="buyer-terms-actions"
                onSubmit={(event: FormEvent<HTMLFormElement>) => {
                  event.preventDefault();
                  void decide(workflow, "reject");
                }}
              >
                <label
                  className="field"
                  htmlFor={`buyer-terms-reason-${workflow.supplierSuborderId}`}
                >
                  Причина отклонения
                  <textarea
                    id={`buyer-terms-reason-${workflow.supplierSuborderId}`}
                    rows={2}
                    maxLength={1000}
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                  />
                </label>
                <div className="action-row">
                  <button
                    className="btn btn-primary"
                    type="button"
                    disabled={busy || stale || refreshing}
                    onClick={() => void decide(workflow, "accept")}
                  >
                    Принять условия v{workflow.currentTermsVersion}
                  </button>
                  <button
                    className="btn btn-ghost"
                    type="submit"
                    disabled={
                      busy || stale || refreshing || rejectReason.trim().length === 0
                    }
                  >
                    Отклонить с причиной
                  </button>
                </div>
              </form>
            ) : null}
          </article>
        );
      })}
    </section>
  );
}
