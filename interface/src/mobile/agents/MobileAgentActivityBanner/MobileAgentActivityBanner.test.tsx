import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";

vi.mock("../../../api/client", () => ({
  api: {
    cancelInstanceTurn: vi.fn().mockResolvedValue(undefined),
    agents: { cancelTurn: vi.fn().mockResolvedValue(undefined) },
  },
}));

import { api } from "../../../api/client";
import { useAgentAttentionStore } from "../../../stores/agent-attention-store";
import { useChatCommandOutboxStore } from "../../../stores/chat-command-outbox";
import { MobileAgentActivityBanner } from "./MobileAgentActivityBanner";

function LocationProbe() {
  const location = useLocation();
  return <output aria-label="Current route">{`${location.pathname}${location.search}`}</output>;
}

function renderBanner(initialEntry = "/projects/proj-1/files") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <MobileAgentActivityBanner />
      <LocationProbe />
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAgentAttentionStore.getState().clear();
  useChatCommandOutboxStore.setState({ commands: [], hydrated: false });
});

describe("MobileAgentActivityBanner", () => {
  it("stays hidden when no other agent session needs awareness", () => {
    renderBanner();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("prioritizes an approval and opens its exact canonical session", async () => {
    useAgentAttentionStore.setState({
      pendingApprovals: {
        approval: {
          kind: "approval",
          requestId: "approval",
          toolName: "run_command",
          agentId: "agent-1",
          projectId: "proj-1",
          agentInstanceId: "instance-1",
          sessionId: "session-1",
          route: "/projects/proj-1/agents/instance-1?session=session-1",
          startedAt: 10,
        },
      },
      activeRuns: {
        duplicate: {
          agentId: "agent-1",
          projectId: "proj-1",
          agentInstanceId: "instance-1",
          sessionId: "session-1",
          route: "/projects/proj-1/agents/instance-1?session=session-1",
          startedAt: 10,
        },
        other: {
          agentId: "agent-2",
          sessionId: "session-2",
          route: "/agents/agent-2?session=session-2",
          startedAt: 20,
        },
      },
      hydrated: true,
    });

    renderBanner();
    const banner = screen.getByRole("button", {
      name: "1 approval waiting · 1 agent working. Open waiting approval",
    });
    expect(banner).toHaveAttribute("data-kind", "approval");
    await userEvent.setup().click(banner);
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "/projects/proj-1/agents/instance-1?session=session-1",
    );
  });

  it("prioritizes a typed question over other agent activity", async () => {
    useAgentAttentionStore.setState({
      pendingInputs: {
        question: {
          kind: "input",
          requestId: "question",
          questions: [{
            id: "scope",
            header: "Scope",
            question: "Which scope?",
            options: [],
            multi_select: false,
          }],
          agentId: "agent-1",
          projectId: "proj-1",
          agentInstanceId: "instance-1",
          sessionId: "session-1",
          route: "/projects/proj-1/agents/instance-1?session=session-1",
          startedAt: 10,
        },
      },
      activeRuns: {
        duplicate: {
          agentId: "agent-1",
          route: "/projects/proj-1/agents/instance-1?session=session-1",
          startedAt: 10,
        },
      },
      hydrated: true,
    });

    renderBanner();
    const banner = screen.getByRole("button", {
      name: "1 answer needed. Open agent question",
    });
    expect(banner).toHaveAttribute("data-kind", "input");
    await userEvent.setup().click(banner);
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "/projects/proj-1/agents/instance-1?session=session-1",
    );
  });

  it("opens a deferred standalone-agent message when no approval is waiting", async () => {
    useChatCommandOutboxStore.setState({
      commands: [{
        surface: "agent",
        commandId: "command-1",
        ownerId: "user-1",
        hostOrigin: "https://aura.example",
        content: "Continue the refactor",
        action: null,
        agentId: "agent-1",
        projectId: "proj-1",
        sessionId: "session-1",
        originallyStartedNewSession: false,
        createdAt: 10,
        attempts: 1,
        nextAttemptAt: 20,
      }],
      hydrated: true,
    });

    renderBanner();
    const banner = screen.getByRole("button", {
      name: "1 message waiting to send. Open pending message",
    });
    expect(banner).toHaveAttribute("data-kind", "outbox");
    await userEvent.setup().click(banner);
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "/agents/agent-1?project=proj-1&session=session-1",
    );
  });

  it("labels a saved but unconfirmed agent run without calling it an unsent message", () => {
    useChatCommandOutboxStore.setState({
      commands: [{
        surface: "agent",
        commandId: "command-uncertain",
        ownerId: "user-1",
        hostOrigin: "https://aura.example",
        content: "Check the deploy",
        action: null,
        agentId: "agent-1",
        projectId: "proj-1",
        sessionId: "session-1",
        originallyStartedNewSession: false,
        createdAt: 10,
        attempts: 1,
        nextAttemptAt: 20,
        accepted: true,
        executionStatus: "unconfirmed",
      }],
      hydrated: true,
    });
    renderBanner();
    expect(screen.getByRole("button", {
      name: "1 agent run unconfirmed. Open unconfirmed agent run",
    })).toBeInTheDocument();
  });

  it("does not duplicate activity for the conversation already on screen", () => {
    useAgentAttentionStore.setState({
      pendingApprovals: {},
      activeRuns: {
        current: {
          agentId: "agent-1",
          projectId: "proj-1",
          agentInstanceId: "instance-1",
          sessionId: "session-1",
          route: "/projects/proj-1/agents/instance-1?session=session-1",
          startedAt: 10,
        },
      },
      hydrated: true,
    });

    renderBanner("/projects/proj-1/agents/instance-1?session=session-1&view=chat");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("stops the exact desktop-started project session without opening it", async () => {
    useAgentAttentionStore.setState({
      pendingApprovals: {},
      activeRuns: {
        "agent-1:proj-1:instance-1:session-1": {
          agentId: "agent-1",
          projectId: "proj-1",
          agentInstanceId: "instance-1",
          sessionId: "session-1",
          route: "/projects/proj-1/agents/instance-1?session=session-1",
          startedAt: 10,
        },
      },
      hydrated: true,
    });

    renderBanner();
    await userEvent.setup().click(screen.getByRole("button", { name: "Stop active agent" }));

    expect(api.cancelInstanceTurn).toHaveBeenCalledWith(
      "proj-1",
      "instance-1",
      "session-1",
    );
    expect(screen.getByLabelText("Current route")).toHaveTextContent(
      "/projects/proj-1/files",
    );
    expect(screen.queryByRole("button", { name: "Stop active agent" })).not.toBeInTheDocument();
  });

  it("stops the exact standalone-agent session", async () => {
    useAgentAttentionStore.setState({
      pendingApprovals: {},
      activeRuns: {
        "agent-1:::session-2": {
          agentId: "agent-1",
          sessionId: "session-2",
          route: "/agents/agent-1?session=session-2",
          startedAt: 10,
        },
      },
      hydrated: true,
    });

    renderBanner();
    await userEvent.setup().click(screen.getByRole("button", { name: "Stop active agent" }));

    expect(api.agents.cancelTurn).toHaveBeenCalledWith("agent-1", "session-2");
  });

  it("shows redacted environment activity without exposing stream content", () => {
    useAgentAttentionStore.setState({
      pendingApprovals: {},
      activeRuns: {
        "agent-1:project-1:instance-1:session-1": {
          agentId: "agent-1",
          projectId: "project-1",
          agentInstanceId: "instance-1",
          sessionId: "session-1",
          route: "/projects/project-1/agents/instance-1?session=session-1",
          startedAt: 10,
          activity: "Inspecting code",
          activeSubagentCount: 2,
        },
      },
      hydrated: true,
    });

    renderBanner();

    expect(screen.getByRole("button", {
      name: "1 agent working · 2 child agents active · Inspecting code. Open active agent",
    })).toBeInTheDocument();
  });
});
