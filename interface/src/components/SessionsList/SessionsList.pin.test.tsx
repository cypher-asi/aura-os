import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnnotatedSession } from "./session-row-utils";
import { SessionsList } from "./SessionsList";

vi.mock("../../api/client", () => ({
  api: { summarizeSession: vi.fn() },
}));

function session(
  id: string,
  title: string,
  pinnedAt: string | null,
): AnnotatedSession {
  return {
    session_id: id,
    agent_instance_id: "ai1",
    project_id: "p1",
    active_task_id: null,
    tasks_worked: [],
    context_usage_estimate: 0,
    total_input_tokens: 0,
    total_output_tokens: 0,
    summary_of_previous_context: title,
    pinned_at: pinnedAt,
    status: "completed",
    started_at: "2026-08-30T12:00:00Z",
    ended_at: null,
    _projectId: "p1",
    _projectName: "Project One",
    _agentInstanceId: "ai1",
  };
}

describe("SessionsList pinning", () => {
  it("groups pinned conversations and offers row-specific pin actions", () => {
    const pinned = session("s1", "Pinned thread", "2026-08-30T13:00:00Z");
    const ordinary = session("s2", "Ordinary thread", null);
    const onSetSessionPinned = vi.fn();
    render(
      <SessionsList
        sessions={[ordinary, pinned]}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        onSetSessionPinned={onSetSessionPinned}
      />,
    );

    expect(screen.getByText("Pinned", { selector: "span" })).toBeInTheDocument();
    expect(screen.getByLabelText("Pinned")).toBeInTheDocument();

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: /Pinned thread/ }));
    fireEvent.click(screen.getByText("Unpin"));
    expect(onSetSessionPinned).toHaveBeenCalledWith(pinned, false);

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Ordinary thread" }));
    fireEvent.click(screen.getByText("Pin to top"));
    expect(onSetSessionPinned).toHaveBeenCalledWith(ordinary, true);
  });
});
