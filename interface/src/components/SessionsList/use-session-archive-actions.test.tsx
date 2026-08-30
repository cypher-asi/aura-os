import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnnotatedSession } from "./session-row-utils";
import { useSessionArchiveActions } from "./use-session-archive-actions";
import { useSessionsListStore } from "../../stores/sessions-list-store";

const archiveSession = vi.fn();
const restoreArchivedSession = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    archiveSession: (...args: unknown[]) => archiveSession(...args),
    restoreArchivedSession: (...args: unknown[]) =>
      restoreArchivedSession(...args),
  },
}));

function makeSession(status: "completed" | "archived"): AnnotatedSession {
  return {
    session_id: "s1",
    agent_instance_id: "ai1",
    project_id: "p1",
    active_task_id: null,
    tasks_worked: [],
    context_usage_estimate: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    summary_of_previous_context: "A chat",
    status,
    started_at: "2026-08-30T12:00:00Z",
    ended_at: null,
    _projectId: "p1",
    _projectName: "Project One",
    _agentInstanceId: "ai1",
  };
}

describe("useSessionArchiveActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionsListStore.setState({
      sessionsBySurface: {},
      deleteErrorBySurface: {},
    });
  });

  it("optimistically archives a session and persists the mutation", () => {
    archiveSession.mockResolvedValue(undefined);
    const session = makeSession("completed");
    useSessionsListStore.setState({
      sessionsBySurface: { "project:p1": [session] },
    });
    const { result } = renderHook(() =>
      useSessionArchiveActions("project:p1"),
    );

    act(() => result.current.archiveSession(session));

    expect(
      useSessionsListStore.getState().sessionsBySurface["project:p1"]?.[0]
        .status,
    ).toBe("archived");
    expect(archiveSession).toHaveBeenCalledWith("p1", "ai1", "s1");
  });

  it("rolls a failed restore back into the archive and surfaces the error", async () => {
    restoreArchivedSession.mockRejectedValue(new Error("network down"));
    const session = makeSession("archived");
    useSessionsListStore.setState({
      sessionsBySurface: { "project:p1": [session] },
    });
    const { result } = renderHook(() =>
      useSessionArchiveActions("project:p1"),
    );

    act(() => result.current.restoreArchivedSession(session));
    expect(
      useSessionsListStore.getState().sessionsBySurface["project:p1"]?.[0]
        .status,
    ).toBe("completed");

    await waitFor(() => {
      expect(
        useSessionsListStore.getState().sessionsBySurface["project:p1"]?.[0]
          .status,
      ).toBe("archived");
    });
    expect(
      useSessionsListStore.getState().deleteErrorBySurface["project:p1"],
    ).toBe("Couldn't restore session: network down");
  });
});
