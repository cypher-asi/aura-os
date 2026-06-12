import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useNavigate, useParams } from "react-router-dom";
import { SharedMainPanel } from "./SharedMainPanel";
import { TerminalPanelBody } from "../TerminalPanelBody";
import { useConversationSurfaceSync } from "../ConversationSurfaceHost/use-conversation-surface-sync";
import { useTerminalPanelStore } from "../../stores/terminal-panel-store";

const terminalHookState = vi.hoisted(() => ({
  counter: 0,
  mounts: [] as Array<{ id: string; cwd?: string; remoteAgentId?: string }>,
  unmounts: [] as string[],
}));

const useTerminalTargetMock = vi.hoisted(() => vi.fn());

vi.mock("../../hooks/use-terminal-target", () => ({
  useTerminalTarget: useTerminalTargetMock,
}));

const setSelectedAgent = vi.hoisted(() => vi.fn());

vi.mock("../../apps/agents/stores", () => ({
  useAgentStore: (selector: (state: { setSelectedAgent: typeof setSelectedAgent }) => unknown) =>
    selector({ setSelectedAgent }),
}));

vi.mock("../../utils/storage", () => ({
  setLastStandaloneAgentId: vi.fn(),
}));

vi.mock("@cypher-asi/zui", () => ({
  cn: (...classNames: Array<string | false | null | undefined>) =>
    classNames.filter(Boolean).join(" "),
}));

// `SharedMainPanel` no longer renders `ResponsiveMainLane` itself — the shell
// (`DesktopShell`) provides the persistent lane wrapper around the active
// app's `MainPanel`. This component is now just a side-effect host for the
// terminal target. No mock for `ResponsiveMainLane` is needed here.

vi.mock("../XTerminal", () => ({
  XTerminal: () => <div data-testid="x-terminal" />,
}));

vi.mock("../../hooks/use-terminal", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  return {
    useTerminal: (opts: { cwd?: string; remoteAgentId?: string }) => {
      const id = React.useMemo(() => `mock-terminal-${++terminalHookState.counter}`, []);

      React.useEffect(() => {
        terminalHookState.mounts.push({
          id,
          cwd: opts.cwd,
          remoteAgentId: opts.remoteAgentId,
        });
        return () => {
          terminalHookState.unmounts.push(id);
        };
      }, [id, opts.cwd, opts.remoteAgentId]);

      return {
        terminalId: id,
        connected: true,
        write: vi.fn(),
        resize: vi.fn(),
        onOutput: () => () => {},
        kill: vi.fn(),
      };
    },
  };
});

/**
 * Mimics the shell-level `ConversationSurfaceHost`: it resolves the route to
 * a conversation target and runs `useConversationSurfaceSync`, which now owns
 * terminal targeting (formerly attempted inside `SharedMainPanel`).
 */
function ConversationRouteSurface() {
  const { projectId, agentInstanceId } = useParams<{
    projectId: string;
    agentInstanceId: string;
  }>();

  useConversationSurfaceSync({
    isConversationRoute: true,
    target:
      projectId && agentInstanceId
        ? { kind: "ready", projectId, agentInstanceId, sessionId: null }
        : { kind: "pending" },
  });

  return (
    <>
      <SharedMainPanel>
        <div data-testid="project-route-content" />
      </SharedMainPanel>
      <TerminalPanelBody embedded />
    </>
  );
}

function ProjectRouteHarness() {
  const navigate = useNavigate();

  return (
    <>
      <button type="button" onClick={() => navigate("/projects/p2/agents/a2")}>
        Switch project
      </button>
      <Routes>
        <Route
          path="/projects/:projectId/agents/:agentInstanceId"
          element={<ConversationRouteSurface />}
        />
      </Routes>
    </>
  );
}

beforeEach(() => {
  terminalHookState.counter = 0;
  terminalHookState.mounts.length = 0;
  terminalHookState.unmounts.length = 0;

  useTerminalPanelStore.setState({
    terminals: [],
    activeId: null,
    panelHeight: 260,
    collapsed: true,
    contentReady: false,
    cwd: undefined,
    remoteAgentId: undefined,
    projectId: undefined,
    modeReady: false,
    targetVersion: 0,
  });

  setSelectedAgent.mockReset();

  useTerminalTargetMock.mockReset();
  useTerminalTargetMock.mockImplementation(
    ({ projectId, agentInstanceId }: { projectId?: string; agentInstanceId?: string }) => {
      if (projectId === "p1" && agentInstanceId === "a1") {
        return {
          remoteAgentId: undefined,
          remoteWorkspacePath: undefined,
          workspacePath: "/workspace/project-one",
          status: "ready" as const,
        };
      }

      if (projectId === "p2" && agentInstanceId === "a2") {
        return {
          remoteAgentId: undefined,
          remoteWorkspacePath: undefined,
          workspacePath: "/workspace/project-two",
          status: "ready" as const,
        };
      }

      return {
        remoteAgentId: undefined,
        remoteWorkspacePath: undefined,
        workspacePath: undefined,
        status: "loading" as const,
      };
    },
  );
});

describe("SharedMainPanel", () => {
  it("recreates the terminal in the selected project workspace when switching agents", async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={["/projects/p1/agents/a1"]}>
        <ProjectRouteHarness />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("project-route-content")).toBeInTheDocument();

    await waitFor(() => {
      expect(terminalHookState.mounts).toHaveLength(1);
    });

    expect(terminalHookState.mounts[0]).toMatchObject({
      cwd: "/workspace/project-one",
      remoteAgentId: undefined,
    });

    const firstTerminalId = terminalHookState.mounts[0].id;

    await user.click(screen.getByRole("button", { name: "Switch project" }));

    await waitFor(() => {
      expect(terminalHookState.mounts).toHaveLength(2);
    });

    expect(terminalHookState.mounts[1]).toMatchObject({
      cwd: "/workspace/project-two",
      remoteAgentId: undefined,
    });
    expect(terminalHookState.unmounts).toContain(firstTerminalId);
    expect(useTerminalPanelStore.getState().cwd).toBe("/workspace/project-two");
    expect(useTerminalPanelStore.getState().targetVersion).toBe(2);
  });
});
