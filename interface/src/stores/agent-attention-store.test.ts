import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPendingToolApprovals, listPendingUserInputs, listActiveStreams } = vi.hoisted(() => ({
  listPendingToolApprovals: vi.fn(),
  listPendingUserInputs: vi.fn(),
  listActiveStreams: vi.fn(),
}));

vi.mock("../shared/api/streams", () => ({
  streamsApi: { listPendingToolApprovals, listPendingUserInputs, listActiveStreams },
}));

import {
  applyAgentAttentionEvent,
  clearAgentAttention,
  hydrateAgentAttention,
  useAgentAttentionStore,
} from "./agent-attention-store";
import { EventType, type AuraEvent } from "../shared/types/aura-events";

function event(type: string, content: Record<string, unknown>): AuraEvent {
  return {
    event_id: `event-${type}`,
    type,
    content,
    user_id: "user-1",
    agent_id: "agent-1",
    project_id: "project-1",
    project_agent_id: "instance-1",
    session_id: "session-1",
    sender: "system",
    org_id: "org-1",
    created_at: "2026-09-22T12:00:00.000Z",
  } as AuraEvent;
}

describe("agent-attention-store", () => {
  beforeEach(() => {
    clearAgentAttention();
    listPendingToolApprovals.mockReset();
    listPendingUserInputs.mockReset().mockResolvedValue({ requests: [] });
    listActiveStreams.mockReset().mockResolvedValue({ streams: [] });
  });

  it("tracks and resolves a live approval with its canonical route", () => {
    applyAgentAttentionEvent(event(EventType.ToolApprovalPrompt, {
      request_id: "approval-1",
      tool_name: "write_file",
      agent_id: "agent-1",
      args: { path: "src/main.ts" },
      remember_options: ["once"],
    }));

    expect(useAgentAttentionStore.getState().pendingApprovals["approval-1"])
      .toMatchObject({
        agentId: "agent-1",
        toolName: "write_file",
        route: "/projects/project-1/agents/instance-1?session=session-1",
      });

    applyAgentAttentionEvent(event(EventType.ToolApprovalResolved, {
      request_id: "approval-1",
    }));
    expect(useAgentAttentionStore.getState().pendingApprovals["approval-1"]).toBeUndefined();
  });

  it("hydrates unresolved approvals for a cold-started mobile client", async () => {
    listPendingToolApprovals.mockResolvedValue({
      approvals: [{
        request_id: "approval-2",
        tool_name: "run_command",
        agent_id: "agent-2",
        project_id: null,
        agent_instance_id: null,
        session_id: "session-2",
        started_at_ms: 42,
      }],
    });

    await hydrateAgentAttention();

    expect(useAgentAttentionStore.getState().hydrated).toBe(true);
    expect(useAgentAttentionStore.getState().pendingApprovals["approval-2"]?.route)
      .toBe("/agents/agent-2?session=session-2");
  });

  it("hydrates and resolves typed input from another client", async () => {
    listPendingToolApprovals.mockResolvedValue({ approvals: [] });
    listPendingUserInputs.mockResolvedValue({
      requests: [{
        request_id: "input-1",
        questions: [{
          id: "strategy",
          header: "Strategy",
          question: "Which path should I take?",
          options: [
            { label: "Safe", description: "Minimize change" },
            { label: "Fast", description: "Optimize delivery" },
          ],
          multi_select: false,
        }],
        agent_id: "agent-2",
        project_id: "project-1",
        agent_instance_id: "instance-2",
        session_id: "session-2",
        started_at_ms: 42,
      }],
    });

    await hydrateAgentAttention();
    expect(useAgentAttentionStore.getState().pendingInputs["input-1"]?.route)
      .toBe("/projects/project-1/agents/instance-2?session=session-2");

    applyAgentAttentionEvent(event(EventType.AgentUserInputResolved, {
      request_id: "input-1",
    }));
    expect(useAgentAttentionStore.getState().pendingInputs["input-1"]).toBeUndefined();
  });

  it("hydrates and follows a desktop-started active run", async () => {
    listPendingToolApprovals.mockResolvedValue({ approvals: [] });
    listActiveStreams.mockResolvedValue({
      streams: [{
        attach_id: "attach-1",
        kind: "chat_turn",
        scope: {
          agent_id: "agent-1",
          project_id: "project-1",
          agent_instance_id: "instance-1",
          session_id: "session-1",
        },
        latest_seq: 4,
        terminated: false,
        started_at_ms: 50,
      }],
    });

    await hydrateAgentAttention();

    expect(Object.values(useAgentAttentionStore.getState().activeRuns)[0]).toMatchObject({
      agentId: "agent-1",
      route: "/projects/project-1/agents/instance-1?session=session-1",
    });
  });

  it("tracks live run start and completion events", () => {
    applyAgentAttentionEvent(event(EventType.UserMessage, { text: "keep going" }));
    expect(Object.values(useAgentAttentionStore.getState().activeRuns)).toHaveLength(1);

    applyAgentAttentionEvent(event(EventType.AssistantMessageEnd, {}));
    expect(Object.values(useAgentAttentionStore.getState().activeRuns)).toHaveLength(0);
  });

  it("accepts a newer turn in the same session from a reconnect snapshot", async () => {
    applyAgentAttentionEvent(event(EventType.UserMessage, { text: "first turn" }));
    applyAgentAttentionEvent(event(EventType.AssistantMessageEnd, {}));
    listPendingToolApprovals.mockResolvedValue({ approvals: [] });
    listActiveStreams.mockResolvedValue({
      streams: [{
        attach_id: "attach-new-turn",
        kind: "chat_turn",
        scope: {
          agent_id: "agent-1",
          project_id: "project-1",
          agent_instance_id: "instance-1",
          session_id: "session-1",
        },
        latest_seq: 1,
        terminated: false,
        started_at_ms: 100,
      }],
    });

    await hydrateAgentAttention();

    expect(Object.values(useAgentAttentionStore.getState().activeRuns)).toHaveLength(1);
  });

  it("does not restore a previous account's snapshot after logout", async () => {
    let resolveFirst: ((value: { approvals: [] }) => void) | undefined;
    listPendingToolApprovals
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce({ approvals: [] });
    listActiveStreams.mockResolvedValue({ streams: [] });

    const staleHydration = hydrateAgentAttention();
    clearAgentAttention();
    const currentHydration = hydrateAgentAttention();
    resolveFirst?.({ approvals: [] });
    await Promise.all([staleHydration, currentHydration]);

    expect(listPendingToolApprovals).toHaveBeenCalledTimes(2);
    expect(useAgentAttentionStore.getState().hydrated).toBe(true);
  });
});
