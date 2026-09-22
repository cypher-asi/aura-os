import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

const mockSourceControlWorkbench = vi.hoisted(() => vi.fn());

vi.mock("../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ hostedLocalHarness: false }),
}));
vi.mock("../../../hooks/use-terminal-target", () => ({
  useTerminalTarget: () => ({
    remoteAgentId: "agent-1",
    remoteAgentInstanceId: "instance-1",
    localAgentInstanceId: undefined,
    remoteWorkspacePath: "/workspace/project",
    workspacePath: "/workspace/project",
    status: "ready",
  }),
}));
vi.mock("../../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: { projects: Array<{ project_id: string; name: string }> }) => unknown) =>
    selector({ projects: [{ project_id: "project-1", name: "Project" }] }),
}));
vi.mock("../../../stores/sessions-list-store", () => ({
  projectSessionsSurfaceKey: (projectId: string) => `project:${projectId}`,
  findMostRecentRealSessionForInstance: () => null,
  useSessionsListStore: (selector: (state: {
    sessionsBySurface: Record<string, unknown>;
    loadingBySurface: Record<string, boolean>;
    loadProjectSessions: () => Promise<void>;
  }) => unknown) => selector({
    sessionsBySurface: {},
    loadingBySurface: {},
    loadProjectSessions: async () => {},
  }),
}));
vi.mock("../../../components/FileExplorer", () => ({
  FileExplorer: () => <div>Remote file tree</div>,
}));
vi.mock("../../../components/SourceControlWorkbench", () => ({
  SourceControlWorkbench: (props: unknown) => {
    mockSourceControlWorkbench(props);
    return <div>Remote Git workbench</div>;
  },
}));
vi.mock("../../../components/PanelSearch", () => ({
  PanelSearch: () => <input aria-label="Search files" />,
}));

import { MobileProjectFilesScreen } from "./ProjectFilesScreen";

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

describe("mobile remote workspace changes", () => {
  it("opens the remote agent's read-only Git changes for the canonical workspace", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/projects/project-1/files?instance=instance-1&agent=agent-1&session=session-1&view=changes"]}>
        <Routes>
          <Route path="/projects/:projectId/files" element={<><MobileProjectFilesScreen /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Remote Git workbench")).toBeInTheDocument();
    expect(mockSourceControlWorkbench).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      agentInstanceId: "instance-1",
      remoteAgentId: "agent-1",
      remoteWorkspacePath: "/workspace/project",
      readOnly: true,
    }));
    await user.click(screen.getByRole("tab", { name: "Files" }));
    expect(screen.getByText("Remote file tree")).toBeInTheDocument();
    expect(screen.getByTestId("location")).not.toHaveTextContent("view=changes");
    expect(screen.getByRole("tab", { name: "Changes" })).toBeInTheDocument();
  });
});
