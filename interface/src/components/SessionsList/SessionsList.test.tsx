import { act, render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Session } from "../../shared/types";
import { SessionsList } from "./SessionsList";
import type { AnnotatedSession } from "./session-row-utils";

vi.mock("../../api/client", () => ({
  api: {
    summarizeSession: vi.fn().mockResolvedValue({ summary_of_previous_context: "" }),
  },
}));

import { api } from "../../api/client";

vi.mock("./SessionsList.module.css", () => ({
  default: new Proxy(
    {},
    {
      get: (_t, prop) => String(prop),
    },
  ),
}));

vi.mock("../EmptyState", () => ({
  EmptyState: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="empty-state">{children}</div>
  ),
}));

vi.mock("../SidekickItemContextMenu", () => ({
  SidekickItemContextMenu: ({ onAction }: { onAction: (id: string) => void }) => (
    <button type="button" data-testid="ctx-delete" onClick={() => onAction("delete")}>
      ctx-delete
    </button>
  ),
  useSidekickItemContextMenu: <T,>({
    resolveItem,
  }: {
    resolveItem: (id: string) => T | null | undefined;
  }) => {
    return {
      menu: null,
      menuRef: { current: null },
      handleContextMenu: () => {},
      closeMenu: () => {},
      __resolve: resolveItem,
    };
  },
}));

function makeSession(
  id: string,
  startedAt: string,
  summary: string,
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
    summary_of_previous_context: summary,
    status: "completed",
    started_at: startedAt,
    ended_at: null,
    _projectId: "proj-1",
    _projectName: "Project One",
    _agentInstanceId: "agent-inst-1",
    ...overrides,
  } as Session as AnnotatedSession;
}

const today = new Date();
const isoToday = today.toISOString();
const isoYesterday = new Date(today.getTime() - 86_400_000).toISOString();
const isoLastWeek = new Date(today.getTime() - 5 * 86_400_000).toISOString();

describe("SessionsList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders date-bucketed rows for sessions with summaries", () => {
    const sessions = [
      makeSession("s1", isoToday, "Refactor sidekick"),
      makeSession("s2", isoYesterday, "Investigate websocket bug"),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Today")).toBeInTheDocument();
    expect(screen.getByText("Yesterday")).toBeInTheDocument();
    expect(screen.getByText("Refactor sidekick")).toBeInTheDocument();
    expect(screen.getByText("Investigate websocket bug")).toBeInTheDocument();
  });

  it("hides untitled sessions until a summary is available", () => {
    const sessions = [
      makeSession("s-titled", isoToday, "Has summary"),
      makeSession("s-untitled", isoToday, ""),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Has summary")).toBeInTheDocument();
    expect(screen.queryByRole("treeitem", { name: /s-untitled/ })).not.toBeInTheDocument();
  });

  it("retries summary generation after an empty first response", async () => {
    vi.useFakeTimers();
    vi.mocked(api.summarizeSession)
      .mockResolvedValueOnce({ summary_of_previous_context: "" })
      .mockResolvedValueOnce({
        summary_of_previous_context: "Summarized first request",
      });

    try {
      render(
        <SessionsList
          sessions={[makeSession("s-new", isoToday, "")]}
          loading={false}
          selectedSessionId={null}
          onSessionClick={vi.fn()}
        />,
      );

      expect(screen.getByRole("treeitem", { name: "New chat" })).toBeInTheDocument();
      await act(async () => {
        await Promise.resolve();
      });
      expect(api.summarizeSession).toHaveBeenCalledTimes(1);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1500);
      });
      await act(async () => {
        await Promise.resolve();
      });

      expect(
        screen.getByRole("treeitem", { name: "Summarized first request" }),
      ).toBeInTheDocument();
      expect(api.summarizeSession).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks the selected session row with aria-current", () => {
    const sessions = [
      makeSession("s1", isoToday, "First"),
      makeSession("s2", isoToday, "Second"),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId="s2"
        onSessionClick={vi.fn()}
      />,
    );

    const second = screen.getByRole("treeitem", { name: "Second" });
    expect(second).toHaveAttribute("aria-current", "page");
    const first = screen.getByRole("treeitem", { name: "First" });
    expect(first).not.toHaveAttribute("aria-current");
  });

  // Regression: a previous implementation rendered one `<Explorer>` per
  // date bucket. Even with controlled `selectedIds`, each Explorer kept
  // its own provider/focus state and the visual selection could appear
  // on rows in multiple sections at once (the "select multiple items
  // across different time periods" bug). With a single bucketed list
  // there is exactly one selected row on the page no matter how many
  // buckets exist.
  it("only highlights one row at a time across date buckets", () => {
    const sessions = [
      makeSession("today-1", isoToday, "Today A"),
      makeSession("today-2", isoToday, "Today B"),
      makeSession("yesterday-1", isoYesterday, "Yesterday A"),
      makeSession("week-1", isoLastWeek, "Earlier"),
    ];

    const { rerender } = render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId="today-1"
        onSessionClick={vi.fn()}
      />,
    );

    const selectedNow = () =>
      screen
        .getAllByRole("treeitem")
        .filter((el) => el.getAttribute("aria-current") === "page");

    expect(selectedNow()).toHaveLength(1);
    expect(selectedNow()[0]).toHaveAccessibleName("Today A");

    rerender(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId="yesterday-1"
        onSessionClick={vi.fn()}
      />,
    );

    expect(selectedNow()).toHaveLength(1);
    expect(selectedNow()[0]).toHaveAccessibleName("Yesterday A");

    rerender(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId="week-1"
        onSessionClick={vi.fn()}
      />,
    );

    expect(selectedNow()).toHaveLength(1);
    expect(selectedNow()[0]).toHaveAccessibleName("Earlier");
  });

  it("selects the optimistic New chat row when the URL has no real session yet", () => {
    const sessions = [
      makeSession("optimistic:new", isoToday, ""),
      makeSession("s1", isoYesterday, "Previous"),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByRole("treeitem", { name: "New chat" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("treeitem", { name: "Previous" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("keeps the explicit selected session over an optimistic New chat fallback", () => {
    const sessions = [
      makeSession("optimistic:new", isoToday, ""),
      makeSession("s1", isoYesterday, "Previous"),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId="s1"
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByRole("treeitem", { name: "Previous" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("treeitem", { name: "New chat" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  // Regression: after `replaceSessionId` swaps the optimistic id for the
  // server-assigned UUID, the row in this list is no longer optimistic
  // but `?session=` may not have propagated through `useSearchParams`
  // yet (the React Router navigate from `useNewSessionUrlSync` lands a
  // tick later). Without the most-recent fallback, the just-created
  // session visibly appeared at the top of the list with its
  // server-generated title but read as unselected for the gap. Falling
  // back to `titledRows[0]` keeps it highlighted.
  it("falls back to the newest row after optimistic→real swap before the URL settles", () => {
    const sessions = [
      // Just-swapped row: real UUID, started_at stamped at insert time
      // so it sorts to the top of TODAY.
      makeSession(
        "11111111-1111-4111-8111-111111111111",
        isoToday,
        "What Is A Cat",
      ),
      makeSession("s1", isoYesterday, "Greeting"),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("treeitem", { name: "What Is A Cat" }),
    ).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("treeitem", { name: "Greeting" })).not.toHaveAttribute(
      "aria-current",
    );
  });

  it("calls onSessionClick with the clicked session", () => {
    const onClick = vi.fn();
    const sessions = [makeSession("s1", isoToday, "Pick me")];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={onClick}
      />,
    );

    fireEvent.click(screen.getByRole("treeitem", { name: "Pick me" }));
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0][0].session_id).toBe("s1");
  });

  // The prefetch hook is wired here (and not in the consumers) so the
  // pointer-enter ordering matches the click ordering — both consumers
  // (`ChatsTab`, projects-app `SessionList`) call into the shared
  // chat-history-store from the handler. The flicker the prefetch
  // exists to prevent only manifests when the cache is cold at click
  // time, so make sure the row actually fires the hook.
  it("calls onSessionHover on row pointer-enter", () => {
    const onHover = vi.fn();
    const sessions = [makeSession("s1", isoToday, "Hover me")];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        onSessionHover={onHover}
      />,
    );

    fireEvent.mouseEnter(screen.getByRole("treeitem", { name: "Hover me" }));
    expect(onHover).toHaveBeenCalledTimes(1);
    expect(onHover.mock.calls[0][0].session_id).toBe("s1");
  });

  it("filters rows by searchQuery (case-insensitive)", () => {
    const sessions = [
      makeSession("s1", isoToday, "Sidekick refactor"),
      makeSession("s2", isoToday, "Websocket bug"),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        searchQuery="websocket"
      />,
    );

    expect(screen.queryByText("Sidekick refactor")).not.toBeInTheDocument();
    expect(screen.getByText("Websocket bug")).toBeInTheDocument();
  });

  it("renders the loading state when sessions are empty and loading", () => {
    render(
      <SessionsList
        sessions={[]}
        loading
        selectedSessionId={null}
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByText("Loading sessions...")).toBeInTheDocument();
  });

  it("renders the empty state when there are no titled sessions", () => {
    render(
      <SessionsList
        sessions={[]}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
      />,
    );

    expect(screen.getByTestId("empty-state")).toHaveTextContent("No sessions yet");
  });

  it("renders the inline delete-error banner and dismiss button", () => {
    const onDismiss = vi.fn();
    render(
      <SessionsList
        sessions={[makeSession("s1", isoToday, "First")]}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        deleteError="Couldn't delete session (409): session has unfinished tasks"
        onDismissError={onDismiss}
      />,
    );

    const banner = screen.getByRole("alert");
    expect(banner).toHaveTextContent(
      "Couldn't delete session (409): session has unfinished tasks",
    );
    fireEvent.click(screen.getByLabelText("Dismiss error"));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("shows the error banner alongside the empty state when there are no sessions", () => {
    render(
      <SessionsList
        sessions={[]}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        deleteError="Couldn't delete session (502): aura-storage unreachable"
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Couldn't delete session (502): aura-storage unreachable",
    );
    expect(screen.getByTestId("empty-state")).toHaveTextContent("No sessions yet");
  });

  // The chat app passes a per-session `<Avatar>` via this hook so each
  // row in the cross-agent inbox shows whose conversation it is on the
  // right side. Anyone NOT passing the prop (agents `ChatsTab`,
  // projects `SessionList`) keeps the existing project-name suffix
  // behavior — covered by the multi-project rendering paths above.
  it("renders renderRowSuffix output on each row when provided", () => {
    const sessions = [
      makeSession("s1", isoToday, "Alpha", {
        _agentInstanceId: "inst-a",
        agent_instance_id: "inst-a",
      } as Partial<AnnotatedSession>),
      makeSession("s2", isoYesterday, "Bravo", {
        _agentInstanceId: "inst-b",
        agent_instance_id: "inst-b",
      } as Partial<AnnotatedSession>),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        renderRowSuffix={(session) => (
          <span data-testid={`suffix-${session.session_id}`}>
            {session._agentInstanceId}
          </span>
        )}
      />,
    );

    expect(screen.getByTestId("suffix-s1")).toHaveTextContent("inst-a");
    expect(screen.getByTestId("suffix-s2")).toHaveTextContent("inst-b");
  });

  it("renders renderRowDetail output as the row secondary line when provided", () => {
    const sessions = [
      makeSession("s1", isoToday, "Alpha", {
        _agentId: "agent-a",
        _projectName: "Project A",
      }),
    ];

    render(
      <SessionsList
        sessions={sessions}
        loading={false}
        selectedSessionId={null}
        onSessionClick={vi.fn()}
        renderRowDetail={(session) => (
          <span data-testid={`detail-${session.session_id}`}>
            {session._agentId} · {session._projectName}
          </span>
        )}
      />,
    );

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByTestId("detail-s1")).toHaveTextContent(
      "agent-a · Project A",
    );
  });
});
