import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { useAgentRowModels } from "./use-agent-row-models";
import { useLoopActivityStore } from "../../../stores/loop-activity-store";
import { useProfileStatusStore } from "../../../stores/profile-status-store";
import { useChatHistoryStore, agentHistoryKey } from "../../../stores/chat-history-store";
import { useProjectsListStore } from "../../../stores/projects-list-store";
import { useSidekickStore } from "../../../stores/sidekick-store";
import { useStreamStore } from "../../../hooks/stream/store";
import { useAgentStore } from "../stores";
import { useAgentAttentionStore } from "../../../stores/agent-attention-store";
import type { Agent } from "../../../shared/types";
import type {
  LoopActivityPayload,
  LoopIdPayload,
} from "../../../shared/types/aura-events";

const agent = { agent_id: "agent-1", is_pinned: false } as Agent;

function reset() {
  useLoopActivityStore.setState({ loops: {}, hydrated: false });
  useStreamStore.setState({ entries: {} });
  useProjectsListStore.setState({
    agentsByProject: {},
    instanceIdsByTemplateId: {},
  });
  useSidekickStore.setState({
    streamingAgentInstanceIds: [],
    streamingAgentInstanceId: null,
  });
  useProfileStatusStore.setState({ statuses: {}, machineTypes: {} });
  useChatHistoryStore.setState({ previewLastMessages: {} });
  useAgentStore.setState({ pinnedAgentIds: new Set<string>() });
  useAgentAttentionStore.setState({
    pendingApprovals: {},
    pendingInputs: {},
    activeRuns: {},
    hydrated: false,
  });
}

function modelFor(includePreview = true) {
  const { result } = renderHook(() =>
    useAgentRowModels([agent], { includePreview }),
  );
  return result.current.get("agent-1");
}

const runningActivity: LoopActivityPayload = {
  status: "running",
  percent: null,
  started_at: "2026-05-16T20:00:00Z",
  last_event_at: "2026-05-16T20:00:05Z",
  current_task_id: null,
  current_step: null,
};

function loopRow(activity: LoopActivityPayload) {
  const loopId: LoopIdPayload = {
    user_id: "user-1",
    project_id: null,
    agent_instance_id: null,
    agent_id: agent.agent_id,
    kind: "chat",
    instance: "loop-1",
  };
  return { [loopId.instance]: { loopId, activity } };
}

describe("useAgentRowModels", () => {
  afterEach(reset);

  it("resolves a local idle agent with no activity", () => {
    reset();
    const model = modelFor();
    expect(model?.busy).toBe(false);
    expect(model?.loopActivity).toBeNull();
    expect(model?.isLocal).toBe(true);
    expect(model?.status).toBe("idle");
  });

  it("marks busy when an active loop exists for the agent", () => {
    reset();
    useLoopActivityStore.setState({ loops: loopRow(runningActivity), hydrated: true });
    const model = modelFor();
    expect(model?.busy).toBe(true);
    expect(model?.loopActivity?.status).toBe("running");
  });

  it("does not mark busy for terminal loop statuses", () => {
    reset();
    useLoopActivityStore.setState({
      loops: loopRow({ ...runningActivity, status: "completed", percent: 1 }),
      hydrated: true,
    });
    expect(modelFor()?.busy).toBe(false);
  });

  it("marks busy when the standalone-agent chat stream is in flight", () => {
    reset();
    useStreamStore.setState({
      entries: { [agent.agent_id]: { isStreaming: true } as never },
    });
    expect(modelFor()?.busy).toBe(true);
  });

  it("marks busy when a project-bound instance of the template is streaming", () => {
    reset();
    useProjectsListStore.setState({
      instanceIdsByTemplateId: { [agent.agent_id]: ["ai-101"] },
    });
    useSidekickStore.setState({
      streamingAgentInstanceIds: ["ai-101"],
      streamingAgentInstanceId: "ai-101",
    });
    expect(modelFor()?.busy).toBe(true);
  });

  it("does not light up for a different template's streaming instance", () => {
    reset();
    useProjectsListStore.setState({
      instanceIdsByTemplateId: { "agent-other": ["ai-other"] },
    });
    useSidekickStore.setState({
      streamingAgentInstanceIds: ["ai-other"],
      streamingAgentInstanceId: "ai-other",
    });
    expect(modelFor()?.busy).toBe(false);
  });

  it("reflects the pinned set and resolves preview only when requested", () => {
    reset();
    useAgentStore.setState({ pinnedAgentIds: new Set(["agent-1"]) });
    useChatHistoryStore.setState({
      previewLastMessages: {
        [agentHistoryKey("agent-1")]: { id: "e", role: "assistant", content: "hi" } as never,
      },
    });

    expect(modelFor(true)?.isPinned).toBe(true);
    expect(modelFor(true)?.lastMessage?.content).toBe("hi");
    expect(modelFor(false)?.lastMessage).toBeUndefined();
  });

  it("aggregates pending approvals by persistent agent identity", () => {
    reset();
    useAgentAttentionStore.setState({
      hydrated: true,
      pendingApprovals: {
        "request-1": {
          kind: "approval",
          requestId: "request-1",
          toolName: "write_file",
          agentId: "agent-1",
          route: "/agents/agent-1?session=session-1",
          startedAt: 10,
        },
        "request-2": {
          kind: "approval",
          requestId: "request-2",
          toolName: "run_command",
          agentId: "agent-1",
          route: "/agents/agent-1?session=session-2",
          startedAt: 20,
        },
      },
    });

    expect(modelFor()?.attention).toEqual({
      kind: "approval",
      count: 2,
      label: "run command",
      route: "/agents/agent-1?session=session-2",
      startedAt: 20,
    });
  });

  it("prioritizes a typed question over approvals for the same agent", () => {
    reset();
    useAgentAttentionStore.setState({
      hydrated: true,
      pendingApprovals: {
        approval: {
          kind: "approval",
          requestId: "approval",
          toolName: "write_file",
          agentId: "agent-1",
          route: "/agents/agent-1?session=session-1",
          startedAt: 20,
        },
      },
      pendingInputs: {
        input: {
          kind: "input",
          requestId: "input",
          questions: [{
            id: "scope",
            header: "Choose scope",
            question: "How broad?",
            options: [],
            multi_select: false,
          }],
          agentId: "agent-1",
          route: "/agents/agent-1?session=session-2",
          startedAt: 10,
        },
      },
    });

    expect(modelFor()?.attention).toMatchObject({
      kind: "input",
      count: 2,
      label: "Choose scope",
      route: "/agents/agent-1?session=session-2",
    });
  });

  it("projects a desktop-started run as busy and directly navigable", () => {
    reset();
    useAgentAttentionStore.setState({
      hydrated: true,
      activeRuns: {
        "run-1": {
          agentId: "agent-1",
          projectId: "project-1",
          agentInstanceId: "instance-1",
          sessionId: "session-1",
          route: "/projects/project-1/agents/instance-1?session=session-1",
          startedAt: 10,
        },
      },
    });

    expect(modelFor()).toMatchObject({
      busy: true,
      activeRun: {
        route: "/projects/project-1/agents/instance-1?session=session-1",
      },
    });
  });
});
