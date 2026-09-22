import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  agents: [] as Array<{ agent_id: string; machine_type: "local" | "remote" }>,
  status: "ready" as "idle" | "loading" | "ready" | "error",
}));

vi.mock("../../stores", () => ({
  useAgents: () => ({ agents: mocks.agents, status: mocks.status }),
}));

vi.mock("../../../../stores/chat-handoff-store", () => ({
  useChatHandoffStore: (selector: (state: { pendingCreateAgentHandoff: null }) => unknown) =>
    selector({ pendingCreateAgentHandoff: null }),
}));

import { AgentChatRoute } from "./AgentChatRoute";

function renderRoute(agentId: string) {
  return render(
    <MemoryRouter initialEntries={[`/agents/${agentId}`]}>
      <Routes>
        <Route path="/agents" element={<div>Agent library</div>} />
        <Route path="/agents/:agentId" element={<><AgentChatRoute /><div>Conversation host</div></>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AgentChatRoute", () => {
  beforeEach(() => {
    mocks.agents = [];
    mocks.status = "ready";
  });

  it("keeps a desktop-local agent readable when its runtime is unavailable", () => {
    mocks.agents = [{ agent_id: "local-1", machine_type: "local" }];

    renderRoute("local-1");

    expect(screen.getByText("Conversation host")).toBeInTheDocument();
    expect(screen.queryByText("Agent library")).not.toBeInTheDocument();
  });

  it("recovers a truly missing agent back to the library", async () => {
    renderRoute("missing");

    await waitFor(() => {
      expect(screen.getByText("Agent library")).toBeInTheDocument();
    });
  });
});
