import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotatedSession } from "./session-row-utils";
import { useSessionRenameAction } from "./use-session-rename-action";
import { useSessionsListStore } from "../../stores/sessions-list-store";

const renameSession = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    renameSession: (...args: unknown[]) => renameSession(...args),
  },
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
    summary_of_previous_context: "Old title",
    status: "completed",
    started_at: "2026-08-30T12:00:00Z",
    ended_at: null,
    _projectId: "p1",
    _projectName: "Project One",
    _agentInstanceId: "ai1",
  };
}

describe("useSessionRenameAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionsListStore.setState({
      sessionsBySurface: {},
      pendingSummariesById: {},
      deleteErrorBySurface: {},
    });
  });

  it("optimistically renames every loaded copy", () => {
    renameSession.mockResolvedValue(undefined);
    const target = session();
    useSessionsListStore.setState({
      sessionsBySurface: {
        "project:p1": [target],
        "agent:a1": [target],
      },
    });
    const { result } = renderHook(() =>
      useSessionRenameAction("project:p1"),
    );

    act(() => result.current(target, "  New title  "));

    const surfaces = useSessionsListStore.getState().sessionsBySurface;
    expect(surfaces["project:p1"]?.[0].summary_of_previous_context).toBe(
      "New title",
    );
    expect(surfaces["agent:a1"]?.[0].summary_of_previous_context).toBe(
      "New title",
    );
    expect(renameSession).toHaveBeenCalledWith("p1", "ai1", "s1", "New title");
  });

  it("rolls back and surfaces a failed rename", async () => {
    renameSession.mockRejectedValue(new Error("network down"));
    const target = session();
    useSessionsListStore.setState({
      sessionsBySurface: { "project:p1": [target] },
    });
    const { result } = renderHook(() =>
      useSessionRenameAction("project:p1"),
    );

    act(() => result.current(target, "New title"));
    await waitFor(() => {
      expect(
        useSessionsListStore.getState().sessionsBySurface["project:p1"]?.[0]
          .summary_of_previous_context,
      ).toBe("Old title");
    });
    expect(
      useSessionsListStore.getState().deleteErrorBySurface["project:p1"],
    ).toBe("Couldn't rename session: network down");
  });
});
