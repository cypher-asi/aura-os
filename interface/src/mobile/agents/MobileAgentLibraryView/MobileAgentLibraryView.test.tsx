import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setQuery: vi.fn(),
  navigate: vi.fn(),
  loadUserSessions: vi.fn(async () => {}),
}));

const recallResult = {
  eventId: "event-1",
  sessionId: "session-1",
  projectId: "project-1",
  agentInstanceId: "instance-1",
  agentId: "agent-1",
  occurredAt: "2026-09-22T12:00:00.000Z",
  role: "assistant" as const,
  snippet: "Desktop migration is ready.",
};

vi.mock("react-router-dom", () => ({
  useNavigate: () => mocks.navigate,
}));

vi.mock("../../../hooks/use-sidebar-search", () => ({
  useSidebarSearch: () => ({
    query: "",
    setQuery: mocks.setQuery,
  }),
}));

vi.mock("../../../components/PanelSearch", () => ({
  PanelSearch: ({
    placeholder,
    value,
    onChange,
  }: {
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock("../../../apps/agents/AgentList", () => ({
  AgentList: ({ mode }: { mode: string }) => (
    <div data-testid="agent-list" data-mode={mode} />
  ),
}));

vi.mock("../../../apps/agents/stores", () => ({
  useAgents: () => ({
    agents: [{ agent_id: "agent-1", name: "Builder Bot" }],
  }),
}));

vi.mock("../../../apps/chat-app/components/RecallModal/RecallModal", () => ({
  RecallModal: ({
    initialQuery,
    onOpenSource,
    resolveMetadata,
  }: {
    initialQuery: string;
    onOpenSource: (result: typeof recallResult) => void;
    resolveMetadata: (result: typeof recallResult) => {
      sessionTitle: string;
      projectName: string;
      agentName: string;
    };
  }) => {
    const metadata = resolveMetadata(recallResult);
    return (
      <section aria-label="Recall past chats">
        <span>{initialQuery}</span>
        <span>{metadata.sessionTitle}</span>
        <span>{metadata.projectName}</span>
        <span>{metadata.agentName}</span>
        <button type="button" onClick={() => onOpenSource(recallResult)}>
          Open source chat
        </button>
      </section>
    );
  },
}));

vi.mock("../../../components/SessionsList", () => ({
  deriveSessionLabel: (session: { summary_of_previous_context?: string }) => (
    session.summary_of_previous_context || "New chat"
  ),
}));

vi.mock("../../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: {
    projects: Array<{ project_id: string; name: string }>;
  }) => unknown) => selector({
    projects: [{ project_id: "project-1", name: "Aura Mobile" }],
  }),
}));

vi.mock("../../../stores/sessions-list-store", () => ({
  USER_SESSIONS_SURFACE_KEY: "user:me",
  useSessionsListStore: (selector: (state: { sessionsBySurface: Record<string, unknown[]> }) => unknown) => (
    selector({
      sessionsBySurface: {
        "user:me": [{
          session_id: "session-1",
          _projectId: "project-1",
          _agentInstanceId: "instance-1",
          _projectName: "Aura Mobile",
          summary_of_previous_context: "Desktop migration decision",
        }],
      },
    })
  ),
  useSessionsListActions: () => ({
    loadUserSessions: mocks.loadUserSessions,
  }),
}));

vi.mock("../PendingAgentSends", () => ({
  PendingAgentSends: () => <div data-testid="pending-agent-sends" />,
}));

import { MobileAgentLibraryView } from "./MobileAgentLibraryView";

describe("MobileAgentLibraryView", () => {
  it("opens server-backed recall and routes to the exact source session", () => {
    render(<MobileAgentLibraryView />);

    fireEvent.click(screen.getByRole("button", { name: "Search all completed chats" }));

    expect(mocks.loadUserSessions).toHaveBeenCalled();
    expect(screen.getByRole("region", { name: "Recall past chats" })).toBeInTheDocument();
    expect(screen.getByText("Desktop migration decision")).toBeInTheDocument();
    expect(screen.getByText("Aura Mobile")).toBeInTheDocument();
    expect(screen.getByText("Builder Bot")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open source chat" }));

    expect(mocks.navigate).toHaveBeenCalledWith(
      "/projects/project-1/agents/instance-1?session=session-1&recall_event=event-1",
    );
  });

  it("exposes touch-native search for agents and shared conversations", () => {
    render(<MobileAgentLibraryView />);

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search agents and conversations" }),
      { target: { value: "desktop migration" } },
    );

    expect(mocks.setQuery).toHaveBeenCalledWith("desktop migration");
    expect(screen.getByTestId("agent-list")).toHaveAttribute(
      "data-mode",
      "mobile-library",
    );
    expect(screen.getByTestId("pending-agent-sends")).toBeInTheDocument();
  });
});
