import { render, screen } from "@testing-library/react";
import type { Agent } from "../../../types";
import { emptyAgentPermissions } from "../../../types/permissions-wire";
import type { DisplaySessionEvent } from "../../../types/stream";

vi.mock("../../../hooks/use-avatar-state", () => ({
  useAvatarState: () => ({ status: "offline", isLocal: true }),
}));

vi.mock("../../../components/Avatar", () => ({
  Avatar: () => <div data-testid="agent-avatar" />,
}));

import { AgentConversationRow } from "./AgentConversationRow";

const baseAgent: Agent = {
  agent_id: "agent-1",
  user_id: "user-1",
  name: "Rose",
  role: "Architect",
  personality: "Plans features end to end.",
  system_prompt: "",
  skills: [],
  icon: null,
  machine_type: "local",
  permissions: emptyAgentPermissions(),
  created_at: "2026-03-20T00:00:00Z",
  updated_at: "2026-03-20T00:00:00Z",
};

const lastMessage: DisplaySessionEvent = {
  id: "evt-1",
  role: "assistant",
  content: "Latest chat reply",
} as DisplaySessionEvent;

describe("AgentConversationRow", () => {
  it("shows the latest chat message by default", () => {
    render(
      <AgentConversationRow
        agent={baseAgent}
        lastMessage={lastMessage}
        isSelected={false}
        onClick={() => {}}
        onContextMenu={() => {}}
        onMouseEnter={() => {}}
      />,
    );

    expect(screen.getByText("Rose")).toBeInTheDocument();
    expect(screen.getAllByText("Architect")).toHaveLength(1);
    expect(screen.getByText("Plans features end to end.")).toBeInTheDocument();
    expect(screen.queryByText("Latest chat reply")).not.toBeInTheDocument();
  });

  it("shows role and summary in metadata mode", () => {
    render(
      <AgentConversationRow
        agent={baseAgent}
        lastMessage={lastMessage}
        showMetadataOnly
        isSelected={false}
        onClick={() => {}}
        onContextMenu={() => {}}
        onMouseEnter={() => {}}
      />,
    );

    expect(screen.getAllByText("Architect")).toHaveLength(1);
    expect(screen.getByText("Plans features end to end.")).toBeInTheDocument();
    expect(screen.queryByText("Latest chat reply")).not.toBeInTheDocument();
  });

  it("falls back to the latest message when the agent has no summary fields", () => {
    render(
      <AgentConversationRow
        agent={{ ...baseAgent, role: "", personality: "" }}
        lastMessage={lastMessage}
        isSelected={false}
        onClick={() => {}}
        onContextMenu={() => {}}
        onMouseEnter={() => {}}
      />,
    );

    expect(screen.getByText("Latest chat reply")).toBeInTheDocument();
  });
});
