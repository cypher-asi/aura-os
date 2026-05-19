import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { Session } from "../../shared/types";
import type { AnnotatedSession } from "./session-row-utils";

const mockSummarize = vi.fn();
vi.mock("../../api/client", () => ({
  api: {
    summarizeSession: (...args: unknown[]) => mockSummarize(...args),
  },
}));

import { useSessionSummaries } from "./use-session-summaries";

function makeSession(
  id: string,
  overrides: Partial<AnnotatedSession> = {},
): AnnotatedSession {
  return {
    session_id: id,
    agent_instance_id: "agent-inst-1",
    project_id: "proj-1",
    active_task_id: null,
    tasks_worked: [],
    context_usage_estimate: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    summary_of_previous_context: "",
    status: "completed",
    started_at: "2025-01-01T00:00:00Z",
    ended_at: null,
    _projectId: "proj-1",
    _projectName: "Project One",
    _agentInstanceId: "agent-inst-1",
    ...overrides,
  } as Session as AnnotatedSession;
}

describe("useSessionSummaries", () => {
  beforeEach(() => {
    mockSummarize.mockReset();
    mockSummarize.mockResolvedValue({ summary_of_previous_context: "" });
  });

  // Regression: `useSessionSummaries` used to fire
  // `/sessions/optimistic:.../summarize` for the optimistic placeholder
  // row inserted by `useOptimisticSessionRow` on "+ New chat" press.
  // The backend's `Path<SessionId>` extractor rejected the non-UUID id
  // with a bare-text 400, polluting the console with a "Bad Request"
  // every time the user opened the sessions panel before SessionReady
  // arrived. Skipping `optimistic:` ids cuts the request out entirely.
  it("does not call summarizeSession for optimistic placeholder rows", async () => {
    renderHook(() =>
      useSessionSummaries([
        makeSession("optimistic:0999aa2a-49d9-420c-b64a-76ee9a8c2805"),
      ]),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it("still summarizes real session rows that lack a persisted summary", async () => {
    mockSummarize.mockResolvedValueOnce({
      summary_of_previous_context: "Refactor sidekick",
    });
    const { result, rerender } = renderHook(
      ({ sessions }: { sessions: AnnotatedSession[] }) => useSessionSummaries(sessions),
      {
        initialProps: {
          sessions: [makeSession("11111111-1111-4111-8111-111111111111")],
        },
      },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSummarize).toHaveBeenCalledTimes(1);
    expect(mockSummarize).toHaveBeenCalledWith(
      "proj-1",
      "agent-inst-1",
      "11111111-1111-4111-8111-111111111111",
    );

    rerender({
      sessions: [
        makeSession("11111111-1111-4111-8111-111111111111", {
          summary_of_previous_context: "Refactor sidekick",
        }),
      ],
    });
    expect(result.current["11111111-1111-4111-8111-111111111111"]).toBe(
      "Refactor sidekick",
    );
  });

  // Mixed list: skip the optimistic row, summarize the real one. Models
  // the common "+ New chat" mid-stream scenario where the panel has
  // both rows for a brief window.
  it("skips optimistic rows while summarizing co-listed real rows", async () => {
    mockSummarize.mockResolvedValue({
      summary_of_previous_context: "Real summary",
    });
    renderHook(() =>
      useSessionSummaries([
        makeSession("optimistic:abc"),
        makeSession("22222222-2222-4222-8222-222222222222"),
      ]),
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockSummarize).toHaveBeenCalledTimes(1);
    expect(mockSummarize).toHaveBeenCalledWith(
      "proj-1",
      "agent-inst-1",
      "22222222-2222-4222-8222-222222222222",
    );
  });
});
