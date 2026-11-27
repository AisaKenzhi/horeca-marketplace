import { createClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it } from "vitest";
import type { Database } from "./database.types";
import { ModerationError, moderationAdapter, moderationErrorMessage } from "./moderation";
import type { WorkspaceClient } from "./workspace";

const orgId = "54000000-0000-4000-8000-000000000001";
const eventId = "55000000-0000-4000-8000-000000000001";
const activeClients: WorkspaceClient[] = [];
let nextKey = 0;

function makeClient(body: unknown, status = 200) {
  const requests: { url: string; payload: unknown }[] = [];
  const fetcher: typeof fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    requests.push({
      url,
      payload: typeof init?.body === "string" ? JSON.parse(init.body) : null,
    });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  };
  const client = createClient<Database>(
    "http://moderation.test",
    "local-publishable-key",
    {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
        storageKey: `sb-moderation-test-${nextKey++}`,
      },
      global: { fetch: fetcher },
    },
  );
  activeClients.push(client);
  return { client, requests };
}

afterEach(async () => {
  for (const client of activeClients.splice(0)) await client.auth.dispose();
});

describe("moderation adapter", () => {
  it("reads the trusted moderator verdict from RPC", async () => {
    const { client, requests } = makeClient(true);
    await expect(moderationAdapter.isModerator(client)).resolves.toBe(true);
    expect(requests[0]?.url).toContain("/rpc/is_platform_moderator");
  });

  it("maps a denied verdict to a typed, safe error", async () => {
    const { client } = makeClient(
      { code: "42501", message: "moderator role required" },
      400,
    );
    await expect(moderationAdapter.isModerator(client)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(moderationErrorMessage(new ModerationError("forbidden"))).toContain(
      "нет полномочий модератора",
    );
  });

  it("decodes pending supplier rows", async () => {
    const { client } = makeClient([
      {
        organization_id: orgId,
        display_name: "Synthetic supplier",
        verification_status: "pending",
        created_at: "2026-11-27T09:00:00.000Z",
      },
    ]);
    await expect(moderationAdapter.listPending(client)).resolves.toEqual([
      {
        organizationId: orgId,
        displayName: "Synthetic supplier",
        verificationStatus: "pending",
        createdAt: "2026-11-27T09:00:00.000Z",
      },
    ]);
  });

  it("sends decision and reason to the narrow RPC and returns the event id", async () => {
    const { client, requests } = makeClient(eventId);
    await expect(
      moderationAdapter.decide(client, orgId, "reject", "  Synthetic reason  "),
    ).resolves.toBe(eventId);
    expect(requests[0]?.url).toContain("/rpc/decide_supplier_verification");
    expect(requests[0]?.payload).toEqual({
      p_organization_id: orgId,
      p_decision: "reject",
      p_reason: "Synthetic reason",
    });
  });

  it("rejects invalid input before any RPC call", async () => {
    const { client, requests } = makeClient(eventId);
    await expect(
      moderationAdapter.decide(client, "not-a-uuid", "approve", "reason"),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(
      moderationAdapter.decide(client, orgId, "approve", "   "),
    ).rejects.toMatchObject({ code: "invalid_input" });
    expect(requests).toEqual([]);
  });

  it("maps an already-decided profile to a safe typed error", async () => {
    const { client } = makeClient(
      { code: "55000", message: "profile is not pending" },
      400,
    );
    await expect(
      moderationAdapter.decide(client, orgId, "approve", "reason"),
    ).rejects.toMatchObject({ code: "invalid_transition" });
  });
});
