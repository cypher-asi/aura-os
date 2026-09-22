import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPendingToolApprovals } = vi.hoisted(() => ({
  listPendingToolApprovals: vi.fn(),
}));

vi.mock("../shared/api/streams", () => ({
  streamsApi: { listPendingToolApprovals },
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

  it("does not restore a previous account's snapshot after logout", async () => {
    let resolveFirst: ((value: { approvals: [] }) => void) | undefined;
    listPendingToolApprovals
      .mockReturnValueOnce(new Promise((resolve) => {
        resolveFirst = resolve;
      }))
      .mockResolvedValueOnce({ approvals: [] });

    const staleHydration = hydrateAgentAttention();
    clearAgentAttention();
    const currentHydration = hydrateAgentAttention();
    resolveFirst?.({ approvals: [] });
    await Promise.all([staleHydration, currentHydration]);

    expect(listPendingToolApprovals).toHaveBeenCalledTimes(2);
    expect(useAgentAttentionStore.getState().hydrated).toBe(true);
  });
});
