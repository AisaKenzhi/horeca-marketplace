import { describe, expect, it } from "vitest";
import type { MembershipRole } from "@/data/supabase/database.types";
import { membershipRoleLabel } from "@/features/account/roleLabels";

describe("membershipRoleLabel", () => {
  it("gives every account role a readable Russian label", () => {
    const roles: readonly MembershipRole[] = [
      "owner",
      "admin",
      "buyer",
      "viewer",
      "receiver",
      "catalog_operator",
      "order_operator",
    ];
    for (const role of roles) {
      expect(membershipRoleLabel(role)).not.toBe(role);
      expect(membershipRoleLabel(role).length).toBeGreaterThan(2);
    }
  });

  it("does not change the underlying role value", () => {
    expect(membershipRoleLabel("viewer")).toBe("Наблюдатель");
    expect(membershipRoleLabel("catalog_operator")).toBe("Оператор каталога");
  });
});
