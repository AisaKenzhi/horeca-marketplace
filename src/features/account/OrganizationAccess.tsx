import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import type { MembershipRole } from "@/data/supabase/database.types";
import { membershipRoleLabel } from "@/features/account/roleLabels";
import {
  changeOrganizationMemberRole,
  createOrganizationInvitation,
  generateInvitationToken,
  invitationLink,
  listOrganizationInvitations,
  listOrganizationMembers,
  removeOrganizationMember,
  revokeOrganizationInvitation,
  workspaceErrorMessage,
  type WorkspaceClient,
  type OrganizationMember,
  type OrganizationInvitation,
} from "@/data/supabase/workspace";

const roles: MembershipRole[] = [
  "admin",
  "buyer",
  "viewer",
  "receiver",
  "catalog_operator",
  "order_operator",
];

export function OrganizationAccess({
  client,
  organizationId,
  userId,
  actorRole,
}: {
  client: WorkspaceClient;
  organizationId: string;
  userId: string;
  actorRole: MembershipRole;
}): ReactNode {
  const [members, setMembers] = useState<OrganizationMember[]>([]);
  const [invitations, setInvitations] = useState<OrganizationInvitation[]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<MembershipRole>("buyer");
  const [shareLink, setShareLink] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const [memberRows, invitationRows] = await Promise.all([
      listOrganizationMembers(client, organizationId),
      listOrganizationInvitations(client, organizationId),
    ]);
    setMembers(memberRows);
    setInvitations(invitationRows);
  }, [client, organizationId]);
  useEffect(() => {
    void refresh().catch((e: unknown) => setError(workspaceErrorMessage(e)));
  }, [refresh]);
  async function act(fn: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
      await refresh();
      setMessage(success);
      return true;
    } catch (e: unknown) {
      setError(workspaceErrorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const token = generateInvitationToken();
    setShareLink("");
    const succeeded = await act(async () => {
      await createOrganizationInvitation(client, organizationId, email, role, token);
      setShareLink(invitationLink(token));
    }, "Приглашение создано. Передайте ссылку получателю вручную.");
    if (succeeded) setEmail("");
  }
  const editableRoles: MembershipRole[] =
    actorRole === "owner" ? ["owner", ...roles] : roles;
  async function copy() {
    try {
      await navigator.clipboard.writeText(shareLink);
      setMessage("Ссылка скопирована.");
    } catch {
      setError(
        "Не удалось скопировать автоматически. Выделите ссылку и скопируйте её вручную.",
      );
    }
  }
  return (
    <section className="card account-section" aria-labelledby="org-access-title">
      <h2 id="org-access-title" className="card-title">
        Участники и приглашения
      </h2>
      <p>
        Приложение не отправляет email. Передайте ссылку получателю вручную в безопасном
        канале. Ссылка действует 7 дней; получатель должен войти под тем же email
        (сравнение без учёта регистра).
      </p>
      <form
        className="account-form account-form-grid"
        onSubmit={(event) => void invite(event)}
      >
        <label className="field">
          Email получателя
          <input
            type="email"
            required
            maxLength={254}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </label>
        <label className="field">
          Роль
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as MembershipRole)}
          >
            {editableRoles.map((value) => (
              <option key={value} value={value}>
                {membershipRoleLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          Создать ссылку-приглашение
        </button>
      </form>
      {shareLink ? (
        <div className="notice notice-info">
          <label className="field">
            Ссылка (не публикуйте и не отправляйте в логи)
            <input readOnly value={shareLink} />
          </label>
          <button className="btn" type="button" onClick={() => void copy()}>
            Скопировать ссылку
          </button>
          <p className="small">
            Скопируйте ссылку сейчас: секрет хранится только в памяти этой страницы и
            после перезагрузки не восстанавливается.
          </p>
        </div>
      ) : null}
      <h3 className="subsection-title">Участники</h3>
      <ul className="account-list">
        {members.map((member) => (
          <li key={member.user_id}>
            <strong>{member.email}</strong>
            <span>Роль: {membershipRoleLabel(member.role)}</span>
            <div className="action-row">
              {member.user_id !== userId ? (
                <>
                  <label className="field">
                    Изменить роль
                    <select
                      aria-label={`Роль ${member.email}`}
                      value={member.role}
                      onChange={(e) =>
                        void act(
                          () =>
                            changeOrganizationMemberRole(
                              client,
                              organizationId,
                              member.user_id,
                              e.target.value as MembershipRole,
                            ),
                          "Роль изменена.",
                        )
                      }
                    >
                      {editableRoles.map((r) => (
                        <option key={r} value={r}>
                          {r}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="btn"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm(`Удалить участника ${member.email}?`))
                        void act(
                          () =>
                            removeOrganizationMember(
                              client,
                              organizationId,
                              member.user_id,
                            ),
                          "Участник удалён.",
                        );
                    }}
                  >
                    Удалить участника
                  </button>
                </>
              ) : (
                <span className="muted">Это ваша учётная запись</span>
              )}
            </div>
          </li>
        ))}
      </ul>
      <h3 className="subsection-title">Ожидающие приглашения</h3>
      <ul className="account-list">
        {invitations.map((invitation) => (
          <li key={invitation.invitation_id}>
            <strong>{invitation.email}</strong>
            <span>
              Роль: {membershipRoleLabel(invitation.role)} · истекает{" "}
              {new Date(invitation.expires_at).toLocaleString()}
            </span>
            <button
              className="btn"
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`Отозвать приглашение для ${invitation.email}?`))
                  void act(
                    () =>
                      revokeOrganizationInvitation(
                        client,
                        organizationId,
                        invitation.invitation_id,
                      ),
                    "Приглашение отозвано.",
                  );
              }}
            >
              Отозвать
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </section>
  );
}
