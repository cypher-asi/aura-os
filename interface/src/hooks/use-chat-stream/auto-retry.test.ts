// Phase 2 auto-retry behavior: when the SSE / harness emits a
// transient `streamDropped`-class error, `buildStreamHandler` should
// hand the error to `onMaybeAutoRetry` first and skip the normal
// `handleStreamError` + pending-artifact cleanup when the hook
// confirms a retry has been scheduled. The complementary classifier
// changes (harness_ws_closed / harness_ws_read_error / harness_protocol_mismatch
// → streamDropped) are covered alongside.

vi.mock("../../api/client", () => ({
  isInsufficientCreditsError: vi.fn(() => false),
  isAgentBusyError: vi.fn(() => false),
  isHarnessCapacityExhaustedError: vi.fn(() => null),
  dispatchInsufficientCredits: vi.fn(),
  api: {},
}));

vi.mock("../../utils/chat-history", () => ({
  extractToolCalls: vi.fn(() => []),
  extractArtifactRefs: vi.fn(() => []),
}));

vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: { getState: () => ({}) },
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => ({}),
}));

vi.mock("../../stores/automation-loop-store", () => ({
  useAutomationLoopStore: { getState: () => ({ loopByProject: {} }) },
}));

vi.mock("../../stores/context-usage-store", () => ({
  useContextUsageStore: { getState: () => ({ bumpEstimatedTokens: vi.fn() }) },
  approxTokensFromText: () => 0,
}));

vi.mock("../../stores/sessions-list-store", () => ({
  useSessionsListStore: { getState: () => ({ bumpVersion: vi.fn() }) },
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { MutableRefObject } from "react";
import { buildStreamHandler } from "./build-stream-handler";
import {
  isStreamDroppedError,
  normalizeStreamError,
} from "../stream/handlers/lifecycle";
import { makeRefs, makeSetters } from "../stream/handlers.test-helpers";

function makeDeps(overrides: Partial<Parameters<typeof buildStreamHandler>[0]> = {}) {
  const refs = makeRefs();
  const setters = makeSetters();
  const abortRef: MutableRefObject<AbortController | null> = { current: null };
  const sidekick = {
    removeSpec: vi.fn(),
    removeTask: vi.fn(),
    setAgentStreaming: vi.fn(),
  };
  return {
    refs,
    setters,
    abortRef,
    sidekick,
    deps: {
      projectId: "p1",
      agentInstanceId: "ai1",
      selectedModel: null,
      refs,
      setters,
      abortRef,
      coreKey: "k1",
      setProgressText: vi.fn(),
      // The unused-stores branch only reads `.current`, so a plain
      // object satisfies the React MutableRefObject contract.
      sidekickRef: { current: sidekick } as unknown as MutableRefObject<
        ReturnType<typeof import("../../stores/sidekick-store").useSidekickStore.getState>
      >,
      projectCtxRef: { current: {} } as unknown as MutableRefObject<
        ReturnType<typeof import("../../stores/project-action-store").useProjectActions>
      >,
      pendingSpecIdsRef: { current: ["pending-tc1"] } as MutableRefObject<string[]>,
      pendingTaskIdsRef: { current: ["pending-tc2"] } as MutableRefObject<string[]>,
      ...overrides,
    },
  };
}

describe("isStreamDroppedError — Phase 2 harness-WS error codes", () => {
  it("classifies harness_ws_closed as streamDropped", () => {
    expect(
      isStreamDroppedError({
        code: "harness_ws_closed",
        message: "harness websocket closed",
      }),
    ).toBe(true);
    expect(
      normalizeStreamError({ code: "harness_ws_closed", message: "harness websocket closed" })
        .displayVariant,
    ).toBe("streamDropped");
  });

  it("classifies harness_ws_read_error as streamDropped", () => {
    expect(
      isStreamDroppedError({
        code: "harness_ws_read_error",
        message: "harness websocket read error: io",
      }),
    ).toBe(true);
  });

  it("classifies harness_protocol_mismatch as streamDropped", () => {
    expect(
      isStreamDroppedError({
        code: "harness_protocol_mismatch",
        message: "unsupported event shape",
      }),
    ).toBe(true);
  });

  it("does not classify unrelated codes as streamDropped", () => {
    expect(
      isStreamDroppedError({ code: "agent_busy", message: "busy" }),
    ).toBe(false);
  });

  it("classifies the Aura Router Anthropic transport failure as streamDropped", () => {
    const error = {
      code: "llm_error",
      message:
        "Anthropic API request failed: error sending request for url (https://aura-router.onrender.com/v1/messages): connection closed before message completed (llm_error)",
    };

    expect(isStreamDroppedError(error)).toBe(true);
    expect(normalizeStreamError(error).displayVariant).toBe("streamDropped");
  });

  it("does not retry non-transport llm errors", () => {
    expect(
      isStreamDroppedError({
        code: "llm_error",
        message: "Anthropic API request failed: invalid model",
      }),
    ).toBe(false);
  });

  it("does not misclassify a structured agent-directory failure as a dropped LLM stream", () => {
    const error = {
      body: { code: "agent_directory_unavailable" },
      message:
        "resolving agent: error sending request for url (https://aura-network.onrender.com/api/agents/a1)",
    };

    expect(isStreamDroppedError(error)).toBe(false);
    expect(normalizeStreamError(error).displayVariant).toBeUndefined();
  });

  it("retries the router's structured mid-stream interruption", () => {
    expect(
      isStreamDroppedError({
        code: "llm_error",
        message: "Provider stream interrupted before completion",
      }),
    ).toBe(true);
  });

  it("uses the connection-to-the-agent wording in the streamDropped banner", () => {
    const normalized = normalizeStreamError({
      code: "harness_ws_closed",
      message: "harness websocket closed",
    });
    expect(normalized.message).toMatch(/connection to the agent dropped/i);
    expect(normalized.message).toMatch(/recovered from history/i);
  });
});

describe("buildStreamHandler.onError — Phase 2 auto-retry path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hands streamDropped errors to onMaybeAutoRetry and skips handleStreamError when it returns true", () => {
    const onMaybeAutoRetry = vi.fn(() => true);
    const { deps, sidekick, setters } = makeDeps({ onMaybeAutoRetry });
    const handler = buildStreamHandler(deps);

    handler.onError(new Error("SSE idle timeout"));

    expect(onMaybeAutoRetry).toHaveBeenCalledTimes(1);
    // No "*Error: ...*" bubble was appended.
    expect(setters.calls.setEvents).toBeUndefined();
    // Optimistic placeholders are preserved across the retry — clearing
    // them would make the user's create_spec / create_task vanish from
    // the sidekick while we silently re-run the turn.
    expect(sidekick.removeSpec).not.toHaveBeenCalled();
    expect(sidekick.removeTask).not.toHaveBeenCalled();
  });

  it("falls back to handleStreamError when onMaybeAutoRetry returns false", () => {
    const onMaybeAutoRetry = vi.fn(() => false);
    const { deps, setters } = makeDeps({ onMaybeAutoRetry });
    const handler = buildStreamHandler(deps);

    handler.onError(new Error("SSE idle timeout"));

    expect(onMaybeAutoRetry).toHaveBeenCalledTimes(1);
    expect(setters.calls.setEvents).toBeDefined();
    // handleStreamError emits two setEvents calls — first a
    // resolve-pending-tools pass via `resolvePendingToolCallsInEvents`,
    // then the error-bubble append. Inspect the latter.
    const calls = setters.calls.setEvents as Array<(prev: unknown[]) => unknown[]>;
    const updater = calls[calls.length - 1];
    const result = updater([]) as Array<{ displayVariant?: string; content: string }>;
    expect(result[0].displayVariant).toBe("streamDropped");
  });

  it("does not consult onMaybeAutoRetry for non-streamDropped errors", () => {
    const onMaybeAutoRetry = vi.fn(() => true);
    const { deps, setters } = makeDeps({ onMaybeAutoRetry });
    const handler = buildStreamHandler(deps);

    handler.onError(new Error("Some other failure"));

    expect(onMaybeAutoRetry).not.toHaveBeenCalled();
    // Hard error path: an *Error: ...* bubble is appended.
    expect(setters.calls.setEvents).toBeDefined();
  });

  it("auto-retries harness_ws_closed delivered as an EventType.Error payload", () => {
    const onMaybeAutoRetry = vi.fn(() => true);
    const { deps, setters } = makeDeps({ onMaybeAutoRetry });
    const handler = buildStreamHandler(deps);

    // EventType.Error is the wire string "error" (see
    // `interface/src/shared/types/aura-events/event-types.ts`).
    handler.onEvent({
      type: "error",
      content: { code: "harness_ws_closed", message: "harness websocket closed", recoverable: true },
    } as unknown as Parameters<typeof handler.onEvent>[0]);

    expect(onMaybeAutoRetry).toHaveBeenCalledTimes(1);
    expect(setters.calls.setEvents).toBeUndefined();
  });
});

describe("buildStreamHandler — auto-retry budget reset on AssistantMessageEnd", () => {
  it("invokes onAssistantTurnCompleted when an AssistantMessageEnd arrives with a non-tool_use stop", () => {
    const onAssistantTurnCompleted = vi.fn();
    const { deps } = makeDeps({ onAssistantTurnCompleted });
    const handler = buildStreamHandler(deps);

    handler.onEvent({
      type: "assistant_message_end",
      content: { stop_reason: "end_turn", usage: {} },
    } as unknown as Parameters<typeof handler.onEvent>[0]);

    expect(onAssistantTurnCompleted).toHaveBeenCalledTimes(1);
  });

  it("does not reset the retry budget while the assistant is still tool_use-looping", () => {
    const onAssistantTurnCompleted = vi.fn();
    const { deps } = makeDeps({ onAssistantTurnCompleted });
    const handler = buildStreamHandler(deps);

    handler.onEvent({
      type: "assistant_message_end",
      content: { stop_reason: "tool_use", usage: {} },
    } as unknown as Parameters<typeof handler.onEvent>[0]);

    expect(onAssistantTurnCompleted).not.toHaveBeenCalled();
  });
});
