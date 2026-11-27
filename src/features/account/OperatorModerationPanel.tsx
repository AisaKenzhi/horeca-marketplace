import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ErrorState, Notice, StatusPill } from "@/components/primitives";
import {
  moderationAdapter,
  moderationErrorMessage,
  type ModerationAdapter,
  type PendingSupplierProfile,
} from "@/data/supabase/moderation";
import type { WorkspaceClient } from "@/data/supabase/workspace";

export function OperatorModerationPanel({
  client,
  adapter = moderationAdapter,
}: {
  readonly client: WorkspaceClient;
  readonly adapter?: ModerationAdapter;
}): ReactNode {
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [rows, setRows] = useState<readonly PendingSupplierProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void adapter
      .isModerator(client)
      .then((verdict) => {
        if (!active) return;
        setAllowed(verdict);
        if (!verdict) {
          setLoading(false);
          return;
        }
        return adapter.listPending(client).then((pending) => {
          if (active) setRows(pending);
        });
      })
      .catch((caught: unknown) => {
        if (active) {
          setAllowed(false);
          setError(moderationErrorMessage(caught));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [adapter, client, refreshKey]);

  async function decide(
    profile: PendingSupplierProfile,
    decision: "approve" | "reject",
    reason: string,
  ): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const eventId = await adapter.decide(
        client,
        profile.organizationId,
        decision,
        reason,
      );
      setMessage(`Решение записано (событие ${eventId.slice(-8)}).`);
      setRefreshKey((value) => value + 1);
    } catch (caught) {
      setError(moderationErrorMessage(caught));
    } finally {
      setBusy(false);
    }
  }

  if (allowed === false && !error) return null;

  return (
    <section
      className="card account-section operator-moderation"
      aria-labelledby="operator-moderation-title"
    >
      <h2 id="operator-moderation-title" className="card-title">
        Очередь проверки поставщиков
      </h2>
      <p className="small muted">
        Только доверенная серверная роль модератора даёт доступ. Решение — внутренний
        статус локального прототипа, не юридическая верификация, сертификация качества или
        разрешение на реальные закупки.
      </p>
      {loading ? (
        <p className="loading" role="status">
          Проверяем полномочия…
        </p>
      ) : null}
      {error ? <ErrorState message={error} /> : null}
      {message ? (
        <p className="ok" role="status" aria-live="polite">
          {message}
        </p>
      ) : null}
      {allowed && !loading && rows.length === 0 ? (
        <p className="empty" role="status">
          Ожидающих проверки профилей нет.
        </p>
      ) : null}
      {allowed
        ? rows.map((profile) => (
            <ModerationRow
              key={profile.organizationId}
              profile={profile}
              busy={busy}
              onDecide={decide}
            />
          ))
        : null}
    </section>
  );
}

function ModerationRow({
  profile,
  busy,
  onDecide,
}: {
  readonly profile: PendingSupplierProfile;
  readonly busy: boolean;
  readonly onDecide: (
    profile: PendingSupplierProfile,
    decision: "approve" | "reject",
    reason: string,
  ) => Promise<void>;
}): ReactNode {
  const [reason, setReason] = useState("");
  const id = `moderation-reason-${profile.organizationId}`;

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    void onDecide(profile, "reject", reason);
  }

  return (
    <article
      className="supplier-suborder-details"
      aria-labelledby={`moderation-title-${profile.organizationId}`}
    >
      <header className="supplier-suborder-detail-heading">
        <h3 id={`moderation-title-${profile.organizationId}`}>{profile.displayName}</h3>
        <StatusPill label="На проверке" tone="warn" />
      </header>
      <p className="small muted">
        Организация {profile.organizationId.slice(-8)} · статус{" "}
        {profile.verificationStatus}
      </p>
      <form className="account-form" onSubmit={(event) => submit(event)}>
        <label className="field" htmlFor={id}>
          Причина решения
          <textarea
            id={id}
            rows={2}
            maxLength={1000}
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <div className="action-row">
          <button
            className="btn btn-primary"
            type="button"
            disabled={busy || reason.trim().length === 0}
            onClick={() => void onDecide(profile, "approve", reason)}
          >
            Одобрить
          </button>
          <button
            className="btn btn-ghost"
            type="submit"
            disabled={busy || reason.trim().length === 0}
          >
            Отклонить
          </button>
        </div>
        <Notice>Причина обязательна и записывается в append-only журнал.</Notice>
      </form>
    </article>
  );
}
