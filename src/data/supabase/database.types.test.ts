import { describe, expectTypeOf, it } from "vitest";
import type { Database, Json } from "./database.types";

type BuyerWorkflowRow =
  Database["public"]["Functions"]["list_buyer_supplier_suborder_workflows"]["Returns"][number];

describe("generated Supabase RPC contracts", () => {
  it("keeps the buyer workflow return shape aligned, including created_at", () => {
    expectTypeOf<BuyerWorkflowRow>().toEqualTypeOf<{
      supplier_suborder_id: string;
      status: string;
      workflow_version: number;
      current_terms_version: number;
      terms_reason: string | null;
      response_deadline_at: string | null;
      created_at: string;
      updated_at: string;
      lines: Json;
    }>();
  });
});
