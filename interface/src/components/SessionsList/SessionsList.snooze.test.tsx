import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnnotatedSession } from "./session-row-utils";
import { SessionsList } from "./SessionsList";

vi.mock("../../api/client", () => ({
  api: { summarizeSession: vi.fn() },
}));

function session(
  id: string,
  title: string,
  snoozedUntil: string | null,
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
    snoozed_until: snoozedUntil,
    status: "completed",
    started_at: "2026-08-30T12:00:00Z",
    ended_at: null,
    _projectId: "p1",
    _projectName: "Project One",
    _agentInstanceId: "ai1",
  };
}

describe("SessionsList snoozing", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("groups sleeping conversations and offers row-specific actions", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T16:00:00Z"));
    const sleeping = session(
      "s1",
      "Sleeping thread",
      "2026-08-30T18:00:00Z",
    );
    const awake = session("s2", "Awake thread", null);
    const onSetSessionSnoozedUntil = vi.fn();
    render(
      <SessionsList
        sessions={[awake, sleeping]}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        onSetSessionSnoozedUntil={onSetSessionSnoozedUntil}
      />,
    );

    const snoozedHeader = screen
      .getByText("Snoozed")
      .closest("[data-list-item]");
    expect(snoozedHeader).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText(/Wakes/)).toBeInTheDocument();

    fireEvent.contextMenu(
      screen.getByRole("treeitem", { name: /Sleeping thread/ }),
    );
    fireEvent.click(screen.getByText("Wake now"));
    expect(onSetSessionSnoozedUntil).toHaveBeenCalledWith(sleeping, null);

    fireEvent.contextMenu(screen.getByRole("treeitem", { name: "Awake thread" }));
    fireEvent.click(screen.getByText("Snooze for 1 hour"));
    expect(onSetSessionSnoozedUntil).toHaveBeenLastCalledWith(
      awake,
      "2026-08-30T17:00:00.000Z",
    );
  });

  it("automatically returns a conversation when its wake time passes", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-30T16:00:00Z"));
    render(
      <SessionsList
        sessions={[
          session("s1", "Short nap", "2026-08-30T16:00:01Z"),
        ]}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
      />,
    );
    expect(screen.getByText("Snoozed")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1_100);
    });

    expect(screen.queryByText("Snoozed")).not.toBeInTheDocument();
    expect(screen.getByText("Short nap")).toBeInTheDocument();
  });
});
