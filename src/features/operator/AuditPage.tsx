import { type ReactNode } from "react";
import { useApp } from "@/app/store";
import { EmptyState, Notice, Section } from "@/components/primitives";
import { canModerateContent } from "@/domain/authorization";

/**
 * Append-only audit log view. Shows synthetic session events only. Metadata is
 * small and non-sensitive by construction; no PII or secrets are recorded.
 */
export function AuditPage(): ReactNode {
  const { state, membership, messages } = useApp();

  if (!canModerateContent(membership)) {
    return (
      <Section heading={messages.nav.audit}>
        <Notice tone="warn">Доступ к журналу ограничен (демо).</Notice>
      </Section>
    );
  }

  const events = [...state.audit].reverse();

  return (
    <Section heading={messages.nav.audit} headingId="audit-heading">
      <Notice tone="info">
        Это журнал событий локальной демо-сессии. Он только добавляется и не содержит
        персональных данных.
      </Notice>
      {events.length === 0 ? (
        <EmptyState message="Событий пока нет. Совершите действие под другой демо-ролью." />
      ) : (
        <table className="table">
          <caption className="sr-only">Журнал событий</caption>
          <thead>
            <tr>
              <th scope="col">Время</th>
              <th scope="col">Роль</th>
              <th scope="col">Действие</th>
              <th scope="col">Сущность</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={e.id}>
                <td data-label="Время">{new Date(e.at).toLocaleString("ru-KZ")}</td>
                <td data-label="Роль">{e.actorRole ?? "—"}</td>
                <td data-label="Действие">{e.action}</td>
                <td data-label="Сущность">
                  {e.entityType}:{e.entityId}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Section>
  );
}
