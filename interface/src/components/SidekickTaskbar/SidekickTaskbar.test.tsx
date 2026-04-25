import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLoopActivityStore } from "../../stores/loop-activity-store";
import { useSidekickStore } from "../../stores/sidekick-store";
import { SidekickTaskbar } from "./SidekickTaskbar";

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ features: { linkedWorkspace: false } }),
}));

vi.mock("../../hooks/use-terminal-target", () => ({
  useTerminalTarget: () => ({
    remoteAgentId: null,
    remoteWorkspacePath: null,
    workspacePath: null,
  }),
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => ({
    project: { project_id: "project-1", current_status: "active" },
    handleArchive: vi.fn(),
  }),
}));

vi.mock("../../stores/terminal-panel-store", () => ({
  useTerminalPanelStore: (selector: (state: { addTerminal: () => void }) => unknown) =>
    selector({ addTerminal: vi.fn() }),
}));

vi.mock("../../stores/browser-panel-store", () => ({
  useBrowserPanelStore: (selector: (state: { addInstance: () => void }) => unknown) =>
    selector({ addInstance: vi.fn() }),
}));

vi.mock("../SidekickTabBar", () => ({
  SidekickTabBar: ({
    tabs,
    activeTab,
  }: {
    tabs: Array<{ id: string; icon: React.ReactNode; title: string }>;
    activeTab: string;
  }) => (
    <div data-testid="sidekick-tabbar" data-active-tab={activeTab}>
      {tabs.map((tab) => (
        <span key={tab.id} data-testid={`tab-${tab.id}`}>
          {tab.icon}
          {tab.title}
        </span>
      ))}
    </div>
  ),
}));

function renderTaskbar() {
  return render(
    <MemoryRouter initialEntries={["/projects/project-1/agents/agent-1"]}>
      <Routes>
        <Route
          path="/projects/:projectId/agents/:agentInstanceId"
          element={<SidekickTaskbar />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SidekickTaskbar", () => {
  beforeEach(() => {
    useSidekickStore.setState({
      activeTab: "run",
      showInfo: false,
      previewItem: null,
      previewHistory: [],
      canGoBack: false,
    });
    useLoopActivityStore.setState({ loops: {}, hydrated: false });
  });

  it("renders active run progress without recursive loop-activity updates", () => {
    useLoopActivityStore.setState({
      hydrated: true,
      loops: {
        "loop-1": {
          loopId: {
            user_id: "user-1",
            project_id: "project-1",
            agent_instance_id: "agent-1",
            agent_id: "agent-template-1",
            kind: "automation",
            instance: "loop-1",
          },
          activity: {
            status: "running",
            percent: null,
            started_at: "2026-04-24T00:00:00.000Z",
            last_event_at: "2026-04-24T00:00:01.000Z",
            current_task_id: "task-1",
          },
        },
      },
    });

    renderTaskbar();

    expect(screen.getByTestId("sidekick-tabbar")).toHaveAttribute(
      "data-active-tab",
      "run",
    );
    expect(screen.getAllByLabelText("running").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("tab-files")).not.toBeInTheDocument();
  });
});
