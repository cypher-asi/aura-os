import { render, screen } from "@testing-library/react";
import type { Agent } from "../../../shared/types";
import {
  emptyAgentPermissions,
  fullAccessAgentPermissions,
} from "../../../shared/types/permissions-wire";
import type { DisplaySessionEvent } from "../../../shared/types/stream";

vi.mock("../../../components/Avatar", () => ({
  Avatar: ({ busy }: { busy?: boolean }) => (
    <div data-testid="agent-avatar" data-busy={busy ? "true" : "false"} />
  ),
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

const noopHandlers = {
  onClick: () => {},
  onContextMenu: () => {},
  onMouseEnter: () => {},
} as const;

describe("AgentConversationRow", () => {
  it("shows the latest chat message as the preview by default", () => {
    render(
      <AgentConversationRow
        agent={baseAgent}
        lastMessage={lastMessage}
        isSelected={false}
        {...noopHandlers}
      />,
    );

    expect(screen.getByText("Rose")).toBeInTheDocument();
    expect(screen.getAllByText("Architect")).toHaveLength(1);
    expect(screen.getByText("Latest chat reply")).toBeInTheDocument();
    expect(screen.queryByText("Plans features end to end.")).not.toBeInTheDocument();
  });

  it("shows the agent role badge for full-access non-CEO agents", () => {
    render(
      <AgentConversationRow
        agent={{ ...baseAgent, permissions: fullAccessAgentPermissions() }}
        lastMessage={lastMessage}
        isSelected={false}
        {...noopHandlers}
      />,
    );

    expect(screen.getByText("Architect")).toBeInTheDocument();
    expect(screen.queryByText("CEO")).not.toBeInTheDocument();
  });

  it("prefixes the preview with 'You: ' for user messages", () => {
    render(
      <AgentConversationRow
        agent={baseAgent}
        lastMessage={{ ...lastMessage, role: "user", content: "hey there" } as DisplaySessionEvent}
        isSelected={false}
        {...noopHandlers}
      />,
    );

    expect(screen.getByText("You: hey there")).toBeInTheDocument();
  });

  it("falls back to the personality when there is no last message", () => {
    render(
      <AgentConversationRow
        agent={baseAgent}
        lastMessage={undefined}
        isSelected={false}
        {...noopHandlers}
      />,
    );

    expect(screen.getByText("Plans features end to end.")).toBeInTheDocument();
  });

  it("falls back to role, then 'Open this agent', when no message and no personality", () => {
    const { rerender } = render(
      <AgentConversationRow
        agent={{ ...baseAgent, personality: "" }}
        lastMessage={undefined}
        isSelected={false}
        {...noopHandlers}
      />,
    );

    // Role appears twice: once as badge, once as preview fallback.
    expect(screen.getAllByText("Architect")).toHaveLength(2);

    rerender(
      <AgentConversationRow
        agent={{ ...baseAgent, role: "", personality: "" }}
        lastMessage={undefined}
        isSelected={false}
        {...noopHandlers}
      />,
    );

    expect(screen.getByText("Open this agent")).toBeInTheDocument();
  });

  it("strips emojis from the last message preview", () => {
    render(
      <AgentConversationRow
        agent={baseAgent}
        lastMessage={{ ...lastMessage, content: "All systems go! \u2705 I'm ready \uD83D\uDE80" } as DisplaySessionEvent}
        isSelected={false}
        {...noopHandlers}
      />,
    );

    expect(screen.getByText("All systems go! I'm ready")).toBeInTheDocument();
  });

  it("falls back to 'New Agent' when the agent name is blank", () => {
    render(
      <AgentConversationRow
        agent={{ ...baseAgent, name: "" }}
        lastMessage={lastMessage}
        isSelected={false}
        {...noopHandlers}
      />,
    );

    expect(screen.getByText("New Agent")).toBeInTheDocument();
    expect(screen.queryByText("Rose")).not.toBeInTheDocument();
  });

  it("prefers personality over last message in metadata-only mode", () => {
    render(
      <AgentConversationRow
        agent={baseAgent}
        lastMessage={lastMessage}
        showMetadataOnly
        isSelected={false}
        {...noopHandlers}
      />,
    );

    expect(screen.getByText("Plans features end to end.")).toBeInTheDocument();
    expect(screen.queryByText("Latest chat reply")).not.toBeInTheDocument();
  });

  it("forwards the busy prop to the avatar", () => {
    const { rerender } = render(
      <AgentConversationRow
        agent={baseAgent}
        lastMessage={lastMessage}
        isSelected={false}
        busy={false}
        {...noopHandlers}
      />,
    );
    expect(screen.getByTestId("agent-avatar")).toHaveAttribute("data-busy", "false");

    rerender(
      <AgentConversationRow
        agent={baseAgent}
        lastMessage={lastMessage}
        isSelected={false}
        busy
        {...noopHandlers}
      />,
    );
    expect(screen.getByTestId("agent-avatar")).toHaveAttribute("data-busy", "true");
  });

  it("prioritizes a pending approval over stale preview metadata", () => {
    render(
      <AgentConversationRow
        agent={baseAgent}
        lastMessage={lastMessage}
        showMetadataOnly
        isSelected={false}
        attention={{
          kind: "approval",
          count: 1,
          toolName: "write_file",
          route: "/agents/agent-1?session=session-1",
        }}
        activeRun={{ route: "/agents/agent-1?session=session-1" }}
        {...noopHandlers}
      />,
    );

    expect(screen.getByText("Needs you")).toBeInTheDocument();
    expect(screen.getByText("Approval needed · write file")).toBeInTheDocument();
    expect(screen.queryByText("Working")).not.toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("data-agent-attention", "approval");
  });

  it("surfaces a desktop-started run when no approval is pending", () => {
    render(
      <AgentConversationRow
        agent={baseAgent}
        lastMessage={lastMessage}
        showMetadataOnly
        isSelected={false}
        busy
        activeRun={{ route: "/agents/agent-1?session=session-1" }}
        {...noopHandlers}
      />,
    );

    expect(screen.getByText("Working")).toBeInTheDocument();
    expect(screen.getByText("Agent is working · Tap to follow")).toBeInTheDocument();
    expect(screen.getByRole("button")).toHaveAttribute("data-agent-activity", "running");
  });
});
