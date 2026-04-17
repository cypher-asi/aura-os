import { act, renderHook, waitFor } from "@testing-library/react";
import type { Session } from "../../types";
import { useSessionListData } from "./useSessionListData";

const listProjectSessions = vi.fn();

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => ({
    project: { project_id: "proj-1" },
  }),
}));

vi.mock("../../api/client", () => ({
  api: {
    listProjectSessions: (...args: unknown[]) => listProjectSessions(...args),
  },
}));

function makeSession(id: string, startedAt: string): Session {
  return {
    session_id: id,
    agent_instance_id: "agent-1",
    project_id: "proj-1",
    active_task_id: null,
    tasks_worked: [],
    context_usage_estimate: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    summary_of_previous_context: "",
    status: "completed",
    started_at: startedAt,
    ended_at: null,
  } as Session;
}

describe("useSessionListData", () => {
  beforeEach(() => {
    listProjectSessions.mockReset();
  });

  it("removeSession drops the session from state", async () => {
    const a = makeSession("s1", "2026-04-16T00:00:00Z");
    const b = makeSession("s2", "2026-04-16T01:00:00Z");
    listProjectSessions.mockResolvedValue([a, b]);

    const { result } = renderHook(() => useSessionListData());

    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(2);
    });

    act(() => {
      result.current.removeSession("s1");
    });

    expect(result.current.sessions.map((s) => s.session_id)).toEqual(["s2"]);
  });

  it("restoreSession re-inserts a session sorted by started_at desc", async () => {
    const older = makeSession("s1", "2026-04-16T00:00:00Z");
    const newer = makeSession("s2", "2026-04-16T02:00:00Z");
    listProjectSessions.mockResolvedValue([newer]);

    const { result } = renderHook(() => useSessionListData());
    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1);
    });

    act(() => {
      result.current.restoreSession(older);
    });

    expect(result.current.sessions.map((s) => s.session_id)).toEqual([
      "s2",
      "s1",
    ]);
  });

  it("restoreSession is a no-op if the session is already present", async () => {
    const a = makeSession("s1", "2026-04-16T00:00:00Z");
    listProjectSessions.mockResolvedValue([a]);

    const { result } = renderHook(() => useSessionListData());
    await waitFor(() => {
      expect(result.current.sessions).toHaveLength(1);
    });

    act(() => {
      result.current.restoreSession(a);
    });

    expect(result.current.sessions).toHaveLength(1);
  });
});
