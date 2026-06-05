import { describe, expect, it, vi } from "vitest";

import { EventType, type AuraEvent } from "../../shared/types/aura-events";
import type { StreamRefs, StreamSetters } from "../../shared/types/stream";
import { makeRefs, makeSetters } from "../stream/handlers.test-helpers";
import { buildStreamHandler } from "./build-stream-handler";

function event(type: EventType, content: Record<string, unknown>): AuraEvent {
  return {
    event_id: `evt-${type}`,
    session_id: "sess-1",
    user_id: "user-1",
    agent_id: "agent-inst-1",
    sender: "agent",
    project_id: "project-1",
    org_id: "org-1",
    type,
    content,
    created_at: "2026-06-05T00:00:00.000Z",
  } as AuraEvent;
}

function makeSidekick() {
  return {
    specs: [],
    tasks: [],
    pushSpec: vi.fn(),
    pushTask: vi.fn(),
    removeSpec: vi.fn(),
    removeTask: vi.fn(),
    setAgentStreaming: vi.fn(),
    notifyAgentInstanceUpdate: vi.fn(),
  };
}

function makeHandler(refs: StreamRefs, setters: StreamSetters) {
  return buildStreamHandler({
    projectId: "project-1",
    agentInstanceId: "agent-inst-1",
    selectedModel: "aura-gpt-5-4",
    refs,
    setters,
    abortRef: { current: null },
    coreKey: "project-1:agent-inst-1",
    setProgressText: vi.fn(),
    sidekickRef: { current: makeSidekick() } as never,
    projectCtxRef: { current: { setProject: vi.fn() } } as never,
    pendingSpecIdsRef: { current: [] },
    pendingTaskIdsRef: { current: [] },
  });
}

describe("buildStreamHandler", () => {
  it("routes chat tool retry and terminal failure events into the stream reducers", () => {
    const refs = makeRefs();
    const setters = makeSetters();
    const handler = makeHandler(refs, setters);

    handler.onEvent(event(EventType.ToolCallStarted, {
      id: "tool-write-1",
      name: "write_file",
    }));
    handler.onEvent(event(EventType.ToolCallRetrying, {
      tool_use_id: "tool-write-1",
      tool_name: "write_file",
      attempt: 2,
      max_attempts: 4,
      delay_ms: 10,
      reason: "upstream_529_overloaded",
    }));
    handler.onEvent(event(EventType.ToolCallFailed, {
      tool_use_id: "tool-write-1",
      tool_name: "write_file",
      reason: "upstream_529_overloaded",
    }));

    expect(refs.toolCalls.current).toHaveLength(1);
    expect(refs.toolCalls.current[0]).toEqual(
      expect.objectContaining({
        id: "tool-write-1",
        name: "write_file",
        pending: false,
        isError: true,
        retrying: false,
        retryAttempt: 2,
        retryMax: 4,
        retryExhausted: true,
        retryReason: "upstream_529_overloaded",
      }),
    );
    expect(refs.toolCalls.current[0]?.result).toContain(
      "Tool call failed after retries: upstream_529_overloaded",
    );
  });
});
