import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AnnotatedSession } from "./session-row-utils";
import { SessionsList } from "./SessionsList";

vi.mock("../../api/client", () => ({
  api: { summarizeSession: vi.fn() },
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
    summary_of_previous_context: "Generated title",
    status: "completed",
    started_at: new Date().toISOString(),
    ended_at: null,
    _projectId: "p1",
    _projectName: "Project One",
    _agentInstanceId: "ai1",
  } as AnnotatedSession;
}

describe("SessionsList rename", () => {
  it("opens an editor from the row menu and submits a bounded title", () => {
    const target = session();
    const onRenameSession = vi.fn();
    render(
      <SessionsList
        sessions={[target]}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        onRenameSession={onRenameSession}
      />,
    );

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Generated title" }));
    fireEvent.click(screen.getByText("Rename"));
    const input = screen.getByRole("textbox", { name: "Session title" });
    expect(input).toHaveValue("Generated title");
    expect(input).toHaveAttribute("maxlength", "120");
    fireEvent.change(input, { target: { value: "User title" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(onRenameSession).toHaveBeenCalledWith(target, "User title");
    expect(screen.queryByRole("form", { name: "Rename session" }))
      .not.toBeInTheDocument();
  });
});
