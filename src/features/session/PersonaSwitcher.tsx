import type { ReactNode } from "react";
import { useApp } from "@/app/store";

/**
 * Demo persona switcher.
 *
 * Lets a reviewer switch between synthetic personas. This is NOT authentication
 * and produces no session tokens; it only changes which in-memory membership is
 * treated as "current" for the prototype.
 */
export function PersonaSwitcher(): ReactNode {
  const { allMemberships, membership, setMembership } = useApp();
  return (
    <label className="persona-switcher">
      <span className="persona-label">Демо-роль:</span>
      <select
        value={membership.id}
        onChange={(e) => setMembership(e.target.value)}
        aria-label="Выбор демонстрационной роли"
      >
        {allMemberships.map((m) => (
          <option key={m.id} value={m.id}>
            {m.displayName} · {m.side}/{m.role}
          </option>
        ))}
      </select>
    </label>
  );
}
