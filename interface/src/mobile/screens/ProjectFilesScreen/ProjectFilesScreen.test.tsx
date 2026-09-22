import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

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
  SourceControlWorkbench: () => <div>Local Git workbench</div>,
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
  it("explains the unavailable Git diff without invoking the server-local workbench", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/projects/project-1/files?instance=instance-1&agent=agent-1&session=session-1&view=changes"]}>
        <Routes>
          <Route path="/projects/:projectId/files" element={<><MobileProjectFilesScreen /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Remote Git changes are not available yet.")).toBeInTheDocument();
    expect(screen.queryByText("Local Git workbench")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Browse files" }));
    expect(screen.getByText("Remote file tree")).toBeInTheDocument();
    expect(screen.getByTestId("location")).not.toHaveTextContent("view=changes");
    expect(screen.queryByRole("tab", { name: "Changes" })).not.toBeInTheDocument();
  });
});
