import { useMemo, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useApp } from "@/app/store";
import { EmptyState, Notice, Section, StatusPill } from "@/components/primitives";
import {
  FULFILLMENT_STATUS_LABELS,
  PAYMENT_STATUS_LABELS,
  SUBORDER_STATUS_LABELS,
} from "@/domain/orderLifecycle";
import { canManageProcurement, visibleSubordersForBuyer } from "@/domain/authorization";
import type { BuyerLocation, SupplierSuborder } from "@/domain/entities";

function statusTone(status: string): "neutral" | "info" | "warn" | "ok" | "bad" {
  switch (status) {
    case "confirmed":
    case "partially_confirmed":
      return "ok";
    case "awaiting_buyer_decision":
    case "change_proposed":
      return "warn";
    case "rejected":
      return "bad";
    default:
      return "info";
  }
}

export function BuyerProcurement(): ReactNode {
  const { state, repo, session, membership, messages } = useApp();

  const locationsById = useMemo(
    () =>
      new Map<string, BuyerLocation>(
        state.buyerLocations.map((l) => [l.id as string, l]),
      ),
    [state.buyerLocations],
  );

  const visible = useMemo(
    () => visibleSubordersForBuyer(membership, state.suborders, locationsById),
    [state.suborders, membership, locationsById],
  );

  const byProcurement = useMemo(() => {
    const map = new Map<string, SupplierSuborder[]>();
    for (const s of visible) {
      const arr = map.get(s.procurementId) ?? [];
      arr.push(s);
      map.set(s.procurementId, arr);
    }
    return map;
  }, [visible]);

  if (byProcurement.size === 0) {
    return (
      <Section heading={messages.procurement.heading}>
        <EmptyState message="Закупок пока нет (демо). Соберите корзину и отправьте её." />
      </Section>
    );
  }

  return (
    <div className="stack">
      {[...byProcurement.entries()].map(([procurementId, suborders]) => {
        const parent = repo.getVisibleParent(session, procurementId);
        const location = parent
          ? state.buyerLocations.find((l) => l.id === parent.locationId)
          : undefined;
        return (
          <Section
            key={procurementId}
            heading={`${messages.procurement.parentLabel}: ${procurementId}`}
            headingId={`proc-${procurementId}`}
          >
            <p className="muted small">
              {messages.procurement.subordersLabel}: {suborders.length}
              {parent ? ` · статус: ${parent.status}` : ""}
              {location ? ` · точка: ${location.name}` : ""}
            </p>
            <ul className="suborder-list">
              {suborders.map((s) => (
                <li key={s.id} className="suborder-item">
                  <div>
                    <strong>
                      {state.suppliers.find((x) => x.id === s.supplierId)?.displayName}
                    </strong>
                    <div className="pill-row">
                      <StatusPill
                        label={`${messages.statuses.agreement}: ${SUBORDER_STATUS_LABELS[s.status]}`}
                        tone={statusTone(s.status)}
                      />
                      <StatusPill
                        label={`${messages.statuses.fulfillment}: ${FULFILLMENT_STATUS_LABELS[s.fulfillmentStatus]}`}
                        tone="neutral"
                      />
                      <StatusPill
                        label={`${messages.statuses.payment}: ${PAYMENT_STATUS_LABELS[s.paymentStatus]}`}
                        tone="neutral"
                      />
                    </div>
                  </div>
                  <Link
                    className="btn btn-ghost"
                    to={`/procurement/${procurementId}?sub=${s.id}`}
                  >
                    {messages.procurement.open}
                  </Link>
                </li>
              ))}
            </ul>
          </Section>
        );
      })}
      {!canManageProcurement(membership, membership.orgId) ? (
        <Notice tone="info">
          Эта демо-роль в режиме просмотра. Действия по закупке недоступны.
        </Notice>
      ) : null}
    </div>
  );
}
