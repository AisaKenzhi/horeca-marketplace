import { type ReactNode } from "react";
import { useApp } from "@/app/store";
import { EmptyState, Notice, Section } from "@/components/primitives";

export function NotificationsPage(): ReactNode {
  const { state, repo, session, membership, messages } = useApp();
  const mine = state.notifications.filter((n) => n.audienceUserId === membership.userId);

  return (
    <Section heading={messages.nav.notifications} headingId="notifications-heading">
      <Notice tone="demo">
        Это локальная демонстрационная панель. Email, SMS, push и мессенджеры не
        подключены и ничего не отправляется.
      </Notice>
      {mine.length === 0 ? (
        <EmptyState message="Демо-уведомлений нет." />
      ) : (
        <ul className="list-simple">
          {mine.map((n) => (
            <li key={n.id}>
              <div>
                <strong>{n.titleDemo}</strong>
                <p className="muted small">{n.bodyDemo}</p>
                <span className="muted small">
                  {new Date(n.createdAt).toLocaleString("ru-KZ")} · канал: {n.channel}{" "}
                  (демо)
                </span>
              </div>
              {!n.read ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => repo.markNotificationRead(session, n.id)}
                >
                  Прочитано
                </button>
              ) : (
                <span className="muted small">прочитано</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}
