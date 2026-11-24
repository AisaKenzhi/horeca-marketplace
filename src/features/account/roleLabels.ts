import type { MembershipRole } from "@/data/supabase/database.types";

/** Human-readable role names for the account workspace. No permission logic here. */
export function membershipRoleLabel(role: MembershipRole): string {
  switch (role) {
    case "owner":
      return "Владелец";
    case "admin":
      return "Администратор";
    case "buyer":
      return "Покупатель";
    case "viewer":
      return "Наблюдатель";
    case "receiver":
      return "Приёмщик";
    case "catalog_operator":
      return "Оператор каталога";
    case "order_operator":
      return "Оператор заказов";
  }
}
