import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotatedSession } from "./session-row-utils";
import { useSessionSnoozeAction } from "./use-session-snooze-action";
import { useSessionsListStore } from "../../stores/sessions-list-store";

const setSessionSnoozedUntil = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    setSessionSnoozedUntil: (...args: unknown[]) =>
      setSessionSnoozedUntil(...args),
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
    summary_of_previous_context: "Follow up later",
    snoozed_until: null,
    status: "completed",
    started_at: "2026-08-30T12:00:00Z",
    ended_at: null,
    _projectId: "p1",
    _projectName: "Project One",
    _agentInstanceId: "ai1",
  };
}

describe("useSessionSnoozeAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionsListStore.setState({
      sessionsBySurface: {},
      pendingSummariesById: {},
      deleteErrorBySurface: {},
    });
  });

  it("optimistically snoozes every loaded copy", () => {
    setSessionSnoozedUntil.mockResolvedValue(undefined);
    const target = session();
    useSessionsListStore.setState({
      sessionsBySurface: {
        "project:p1": [target],
        "agent:a1": [target],
      },
    });
    const { result } = renderHook(() =>
      useSessionSnoozeAction("project:p1"),
    );
    const wakeAt = "2026-09-01T13:00:00Z";

    act(() => result.current(target, wakeAt));

    const surfaces = useSessionsListStore.getState().sessionsBySurface;
    expect(surfaces["project:p1"]?.[0].snoozed_until).toBe(wakeAt);
    expect(surfaces["agent:a1"]?.[0].snoozed_until).toBe(wakeAt);
    expect(setSessionSnoozedUntil).toHaveBeenCalledWith(
      "p1",
      "ai1",
      "s1",
      wakeAt,
    );
  });

  it("rolls back and surfaces a failed snooze", async () => {
    setSessionSnoozedUntil.mockRejectedValue(new Error("network down"));
    const target = session();
    useSessionsListStore.setState({
      sessionsBySurface: { "project:p1": [target] },
    });
    const { result } = renderHook(() =>
      useSessionSnoozeAction("project:p1"),
    );

    act(() => result.current(target, "2026-09-01T13:00:00Z"));
    await waitFor(() => {
      expect(
        useSessionsListStore.getState().sessionsBySurface["project:p1"]?.[0]
          .snoozed_until,
      ).toBeNull();
    });
    expect(
      useSessionsListStore.getState().deleteErrorBySurface["project:p1"],
    ).toBe("Couldn't snooze session: network down");
  });
});
