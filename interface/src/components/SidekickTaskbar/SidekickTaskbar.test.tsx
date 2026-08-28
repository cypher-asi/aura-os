import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLoopActivityStore } from "../../stores/loop-activity-store";
import { useSidekickStore } from "../../stores/sidekick-store";
import { SidekickTaskbar } from "./SidekickTaskbar";

const {
  mockHandleStartLoopEngineering,
  mockUseAutomationStatus,
  mockWorkspaceState,
} = vi.hoisted(() => ({
  mockHandleStartLoopEngineering: vi.fn(),
  mockUseAutomationStatus: vi.fn(),
  mockWorkspaceState: {
    linkedWorkspace: false,
    hostedLocalHarness: false,
    terminalTarget: {
      remoteAgentId: null as string | null,
      remoteAgentInstanceId: null as string | null,
      remoteWorkspacePath: null as string | null,
      workspacePath: null as string | null,
      localAgentInstanceId: null as string | null,
    },
  },
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({
    features: { linkedWorkspace: mockWorkspaceState.linkedWorkspace },
    hostedLocalHarness: mockWorkspaceState.hostedLocalHarness,
  }),
}));

vi.mock("../../hooks/use-terminal-target", () => ({
  useTerminalTarget: () => mockWorkspaceState.terminalTarget,
}));

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => ({
    project: { project_id: "project-1", current_status: "active" },
    handleArchive: vi.fn(),
  }),
}));

vi.mock("../SidekickTabBar", () => ({
  SidekickTabBar: ({
    tabs,
    activeTab,
    onInlineAction,
  }: {
    tabs: Array<{
      id: string;
      icon: React.ReactNode;
      title: string;
      kind?: "tab" | "action";
    }>;
    activeTab: string;
    onInlineAction?: (id: string) => void;
  }) => (
    <div data-testid="sidekick-tabbar" data-active-tab={activeTab}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          data-testid={`tab-${tab.id}`}
          onClick={() => {
            if (tab.kind === "action") onInlineAction?.(tab.id);
          }}
        >
          {tab.icon}
          {tab.title}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../AutomationBar/useAutomationStatus", () => ({
  useAutomationStatus: (...args: unknown[]) => mockUseAutomationStatus(...args),
}));

vi.mock("../AutomationBar/LoopEngineeringPanel", () => ({
  LoopEngineeringPanel: ({
    projectId,
    canStart,
    onStart,
  }: {
    projectId: string;
    canStart: boolean;
    onStart: (contract: unknown) => Promise<void>;
  }) => (
    <div data-testid="loop-engineering-panel" data-project-id={projectId}>
      <button
        data-testid="start-loop-engineering"
        disabled={!canStart}
        onClick={() =>
          void onStart({
            goal: "Fix a failing checkout flow",
            successCriteria: ["Checkout completes", "Regression test passes"],
            verifierCommands: [
              {
                label: "checkout test",
                command: "npm test -- checkout",
                expectedOutcome: "pass",
              },
            ],
            maxIterations: 4,
            approvalPolicy: "apply_within_workspace",
            learning: {
              captureTrace: true,
              proposeEvals: true,
              proposeSkills: true,
              summarizeRegressions: true,
            },
          })
        }
      >
        Start Loop Engineering
      </button>
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

function setRunningLoop() {
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
    mockHandleStartLoopEngineering.mockReset();
    mockHandleStartLoopEngineering.mockResolvedValue(undefined);
    mockUseAutomationStatus.mockReset();
    mockUseAutomationStatus.mockReturnValue({
      canStartLoopEngineering: true,
      handleStartLoopEngineering: mockHandleStartLoopEngineering,
      startError: null,
      clearStartError: vi.fn(),
    });
    mockWorkspaceState.linkedWorkspace = false;
    mockWorkspaceState.hostedLocalHarness = false;
    mockWorkspaceState.terminalTarget = {
      remoteAgentId: null,
      remoteAgentInstanceId: null,
      remoteWorkspacePath: null,
      workspacePath: null,
      localAgentInstanceId: null,
    };
  });

  it("renders active run progress without recursive loop-activity updates", () => {
    setRunningLoop();

    renderTaskbar();

    expect(screen.getByTestId("sidekick-tabbar")).toHaveAttribute(
      "data-active-tab",
      "run",
    );
    expect(screen.getAllByLabelText("running").length).toBeGreaterThan(0);
    expect(screen.queryByTestId("tab-files")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-terminal")).not.toBeInTheDocument();
  });

  it("hides Loop Engineering when no project workspace is reachable", () => {
    renderTaskbar();

    expect(screen.queryByTestId("tab-loop-engineering")).not.toBeInTheDocument();
  });

  it("redirects stale Terminal state to Chats when workspace tools are unavailable", async () => {
    useSidekickStore.setState({ activeTab: "terminal" });

    renderTaskbar();

    await waitFor(() =>
      expect(screen.getByTestId("sidekick-tabbar")).toHaveAttribute(
        "data-active-tab",
        "sessions",
      ),
    );
  });

  it("shows Terminal and Files for linked desktop workspaces", () => {
    mockWorkspaceState.linkedWorkspace = true;
    mockWorkspaceState.terminalTarget = {
      remoteAgentId: null,
      remoteAgentInstanceId: null,
      remoteWorkspacePath: null,
      workspacePath: "/Users/demo/project",
    };

    renderTaskbar();

    expect(screen.getByTestId("tab-terminal")).toBeInTheDocument();
    expect(screen.getByTestId("tab-source-control")).toBeInTheDocument();
    expect(screen.getByTestId("tab-files")).toBeInTheDocument();
  });

  it("shows Terminal and Files for remote workspaces in web", () => {
    mockWorkspaceState.linkedWorkspace = false;
    mockWorkspaceState.terminalTarget = {
      remoteAgentId: "remote-agent-1",
      remoteAgentInstanceId: "remote-inst-1",
      remoteWorkspacePath: "/workspace/project",
      workspacePath: "/workspace/project",
    };

    renderTaskbar();

    expect(screen.getByTestId("tab-terminal")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-source-control")).not.toBeInTheDocument();
    expect(screen.getByTestId("tab-files")).toBeInTheDocument();
  });

  it("shows hosted Files beside Preview without exposing desktop-only workspace tools", () => {
    mockWorkspaceState.hostedLocalHarness = true;
    mockWorkspaceState.terminalTarget = {
      remoteAgentId: null,
      remoteAgentInstanceId: null,
      localAgentInstanceId: "local-inst-1",
      remoteWorkspacePath: null,
      workspacePath: null,
    };

    renderTaskbar();

    expect(screen.getByTestId("tab-files")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-terminal")).not.toBeInTheDocument();
    expect(screen.queryByTestId("tab-source-control")).not.toBeInTheDocument();
    const tabs = screen.getByTestId("sidekick-tabbar");
    const orderedIds = Array.from(tabs.querySelectorAll("button")).map((button) =>
      button.getAttribute("data-testid"),
    );
    expect(orderedIds.indexOf("tab-files")).toBe(orderedIds.indexOf("tab-browser") + 1);
  });

  it("redirects stale Source Control state when only a remote workspace is available", async () => {
    useSidekickStore.setState({ activeTab: "source-control" });
    mockWorkspaceState.terminalTarget = {
      remoteAgentId: "remote-agent-1",
      remoteAgentInstanceId: "remote-inst-1",
      remoteWorkspacePath: "/workspace/project",
      workspacePath: "/workspace/project",
    };

    renderTaskbar();

    await waitFor(() =>
      expect(screen.getByTestId("sidekick-tabbar")).toHaveAttribute(
        "data-active-tab",
        "sessions",
      ),
    );
  });

  it("keeps browseable remote tabs but hides Loop Engineering without a remote instance id", () => {
    mockWorkspaceState.linkedWorkspace = false;
    mockWorkspaceState.terminalTarget = {
      remoteAgentId: "remote-agent-1",
      remoteAgentInstanceId: null,
      remoteWorkspacePath: "/workspace/project",
      workspacePath: "/Users/demo/project",
    };

    renderTaskbar();

    expect(screen.getByTestId("tab-terminal")).toBeInTheDocument();
    expect(screen.getByTestId("tab-files")).toBeInTheDocument();
    expect(screen.queryByTestId("tab-loop-engineering")).not.toBeInTheDocument();
  });

  it("keeps the Run tab's Play glyph visible and overlays a progress ring while the loop is active", () => {
    setRunningLoop();

    renderTaskbar();

    // Pin the affordance: the Run tab still renders the Play
    // polygon so users recognise it as the Run/Play button, and the
    // rotating ring sits in the same SVG to communicate "currently
    // working". `PlayLoopGlyph` draws both shapes inline, so we
    // assert on the polygon (not a lucide class name) and on the
    // ring testid.
    const runTab = screen.getByTestId("tab-run");
    expect(runTab.querySelector("svg polygon")).toBeInTheDocument();
    expect(runTab.querySelector("[data-testid='play-loop-ring']"))
      .toBeInTheDocument();
  });

  it("does not render the Run tab's progress ring while the loop is idle", () => {
    // No loop in the store at all → idle. The Play polygon must
    // stay visible (so the tab is still usable) and the ring must
    // not render (so the tab does not look perpetually busy).
    renderTaskbar();

    const runTab = screen.getByTestId("tab-run");
    expect(runTab.querySelector("svg polygon")).toBeInTheDocument();
    expect(runTab.querySelector("[data-testid='play-loop-ring']"))
      .not.toBeInTheDocument();
  });

  it("keeps the Tasks tab's Check glyph visible and overlays a progress ring while the loop is active", () => {
    setRunningLoop();

    renderTaskbar();

    // Mirror of the Run-tab assertion above: when a task loop is
    // active the Tasks tab must keep its Check polyline visible (so
    // users still recognise it) and add the rotating ring in the
    // same SVG via `CheckLoopGlyph`. The earlier behaviour swapped
    // the entire icon for a bare `LoopProgress` spinner, which
    // failed both criteria.
    const tasksTab = screen.getByTestId("tab-tasks");
    expect(tasksTab.querySelector("svg polyline")).toBeInTheDocument();
    expect(tasksTab.querySelector("[data-testid='check-loop-ring']"))
      .toBeInTheDocument();
  });

  it("does not render the Tasks tab's progress ring while the loop is idle", () => {
    renderTaskbar();

    const tasksTab = screen.getByTestId("tab-tasks");
    expect(tasksTab.querySelector("svg polyline")).toBeInTheDocument();
    expect(tasksTab.querySelector("[data-testid='check-loop-ring']"))
      .not.toBeInTheDocument();
  });

  it("does not render the Run tab's progress ring once the loop reaches a terminal status", () => {
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
            status: "completed",
            percent: 1,
            started_at: "2026-04-24T00:00:00.000Z",
            last_event_at: "2026-04-24T00:00:05.000Z",
            current_task_id: null,
          },
        },
      },
    });

    renderTaskbar();

    // Terminal status → ring goes away, Play polygon stays so the
    // user can immediately restart the run.
    const runTab = screen.getByTestId("tab-run");
    expect(runTab.querySelector("svg polygon")).toBeInTheDocument();
    expect(runTab.querySelector("[data-testid='play-loop-ring']"))
      .not.toBeInTheDocument();
  });

  it("opens Loop Engineering from the active sidekick taskbar and starts with a contract", async () => {
    mockWorkspaceState.linkedWorkspace = true;
    mockWorkspaceState.terminalTarget = {
      remoteAgentId: null,
      remoteAgentInstanceId: null,
      remoteWorkspacePath: null,
      workspacePath: "/Users/demo/project",
    };

    renderTaskbar();

    fireEvent.click(screen.getByTestId("tab-loop-engineering"));

    await waitFor(() =>
      expect(screen.getByTestId("loop-engineering-panel")).toHaveAttribute(
        "data-project-id",
        "project-1",
      ),
    );

    fireEvent.click(screen.getByTestId("start-loop-engineering"));

    await waitFor(() =>
      expect(mockHandleStartLoopEngineering).toHaveBeenCalledWith(
        expect.objectContaining({
          goal: "Fix a failing checkout flow",
          successCriteria: ["Checkout completes", "Regression test passes"],
          verifierCommands: [
            {
              label: "checkout test",
              command: "npm test -- checkout",
              expectedOutcome: "pass",
            },
          ],
          approvalPolicy: "apply_within_workspace",
          learning: expect.objectContaining({
            captureTrace: true,
            proposeEvals: true,
            proposeSkills: true,
            summarizeRegressions: true,
          }),
        }),
      ),
    );
  });

  it("starts Sidekick Loop Engineering against the resolved remote project-agent instance", async () => {
    mockWorkspaceState.linkedWorkspace = false;
    mockWorkspaceState.terminalTarget = {
      remoteAgentId: "remote-template-1",
      remoteAgentInstanceId: "remote-inst-1",
      remoteWorkspacePath: "/workspace/project",
      workspacePath: "/workspace/project",
    };

    renderTaskbar();

    fireEvent.click(screen.getByTestId("tab-loop-engineering"));

    await waitFor(() =>
      expect(mockUseAutomationStatus).toHaveBeenCalledWith(
        "project-1",
        "remote-inst-1",
        {
          allowDetachedReattach: true,
          detachedReattachAgentInstanceId: "remote-inst-1",
        },
      ),
    );
  });
});
