import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotatedSession } from "./session-row-utils";
import { useSessionPinAction } from "./use-session-pin-action";
import { useSessionsListStore } from "../../stores/sessions-list-store";

const setSessionPinned = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    setSessionPinned: (...args: unknown[]) => setSessionPinned(...args),
  },
  ApiClientError: class ApiClientError extends Error {},
}));

function session(): AnnotatedSession {
  return {
    session_id: "s1",
    agent_instance_id: "ai1",
    project_id: "p1",
    active_task_id: null,
    tasks_worked: [],
    context_usage_estimate: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    summary_of_previous_context: "Important thread",
    pinned_at: null,
    status: "completed",
    started_at: "2026-08-30T12:00:00Z",
    ended_at: null,
    _projectId: "p1",
    _projectName: "Project One",
    _agentInstanceId: "ai1",
  };
}

describe("useSessionPinAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionsListStore.setState({
      sessionsBySurface: {},
      pendingSummariesById: {},
      deleteErrorBySurface: {},
    });
  });

  it("optimistically pins every loaded copy", () => {
    setSessionPinned.mockResolvedValue(undefined);
    const target = session();
    useSessionsListStore.setState({
      sessionsBySurface: {
        "project:p1": [target],
        "agent:a1": [target],
      },
    });
    const { result } = renderHook(() => useSessionPinAction("project:p1"));

    act(() => result.current(target, true));

    const surfaces = useSessionsListStore.getState().sessionsBySurface;
    expect(surfaces["project:p1"]?.[0].pinned_at).toBeTruthy();
    expect(surfaces["agent:a1"]?.[0].pinned_at).toBe(
      surfaces["project:p1"]?.[0].pinned_at,
    );
    expect(setSessionPinned).toHaveBeenCalledWith("p1", "ai1", "s1", true);
  });

  it("rolls back and surfaces a failed pin", async () => {
    setSessionPinned.mockRejectedValue(new Error("network down"));
    const target = session();
    useSessionsListStore.setState({
      sessionsBySurface: { "project:p1": [target] },
    });
    const { result } = renderHook(() => useSessionPinAction("project:p1"));

    act(() => result.current(target, true));
    await waitFor(() => {
      expect(
        useSessionsListStore.getState().sessionsBySurface["project:p1"]?.[0]
          .pinned_at,
      ).toBeNull();
    });
    expect(
      useSessionsListStore.getState().deleteErrorBySurface["project:p1"],
    ).toBe("Couldn't pin session: network down");
  });
});
