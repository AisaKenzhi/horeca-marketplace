// @vitest-environment jsdom
import { createClient } from "@supabase/supabase-js";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/data/supabase/database.types";
import {
  ModerationError,
  type ModerationAdapter,
  type PendingSupplierProfile,
} from "@/data/supabase/moderation";
import { OperatorModerationPanel } from "./OperatorModerationPanel";

const client = createClient<Database>(
  "http://moderation-ui.test",
  "local-publishable-key",
  {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  },
);
const orgId = "54000000-0000-4000-8000-000000000001";
const eventId = "55000000-0000-4000-8000-000000000001";
const pending: PendingSupplierProfile = {
  organizationId: orgId,
  displayName: "Synthetic supplier",
  verificationStatus: "pending",
  createdAt: "2026-11-27T09:00:00.000Z",
};

function makeAdapter(
  verdict: boolean,
  rows: readonly PendingSupplierProfile[],
  decideError?: ModerationError,
): { adapter: ModerationAdapter; decide: ReturnType<typeof vi.fn> } {
  const decide = vi.fn<ModerationAdapter["decide"]>();
  if (decideError) decide.mockRejectedValue(decideError);
  else decide.mockResolvedValue(eventId);
  return {
    adapter: {
      isModerator: vi.fn().mockResolvedValue(verdict),
      listPending: vi.fn().mockResolvedValue(rows),
      decide: (c, organizationId, decision, reason) =>
        decide(c, organizationId, decision, reason),
    },
    decide,
  };
}

afterEach(() => cleanup());

describe("OperatorModerationPanel", () => {
  it("renders nothing for a non-moderator", async () => {
    const { adapter } = makeAdapter(false, []);
    const { container } = render(
      <OperatorModerationPanel client={client} adapter={adapter} />,
    );
    await vi.waitFor(() => expect(container).toBeEmptyDOMElement());
  });

  it("requires a reason and records the decision through trusted RPC", async () => {
    const user = userEvent.setup();
    const { adapter, decide } = makeAdapter(true, [pending]);
    render(<OperatorModerationPanel client={client} adapter={adapter} />);

    const card = await screen.findByRole("article", { name: "Synthetic supplier" });
    expect(within(card).getByText(/Организация/)).toBeTruthy();
    const approve = within(card).getByRole("button", { name: "Одобрить" });
    expect(approve).toBeDisabled();
    await user.type(within(card).getByLabelText("Причина решения"), "Synthetic decision");
    await user.click(approve);

    expect(decide).toHaveBeenCalledWith(client, orgId, "approve", "Synthetic decision");
    expect(await screen.findByText(/Решение записано/)).toBeTruthy();
  });

  it("shows a safe error when the role is denied", async () => {
    const { adapter } = makeAdapter(true, [pending], new ModerationError("forbidden"));
    render(<OperatorModerationPanel client={client} adapter={adapter} />);
    const card = await screen.findByRole("article", { name: "Synthetic supplier" });
    const user = userEvent.setup();
    await user.type(within(card).getByLabelText("Причина решения"), "Synthetic reason");
    await user.click(within(card).getByRole("button", { name: "Одобрить" }));
    expect(await screen.findByText(/нет полномочий модератора/)).toBeTruthy();
  });
});
