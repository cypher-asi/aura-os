import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const mockProjectsListState = {
  agentsByProject: {} as Record<string, unknown[]>,
  loadingAgentsByProject: {} as Record<string, boolean>,
};

const mockCapabilities = {
  isMobileLayout: false,
};

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockCapabilities,
}));

vi.mock("../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: typeof mockProjectsListState) => unknown) =>
    selector(mockProjectsListState),
}));

vi.mock("../ProjectEmptyView", () => ({
  ProjectEmptyView: () => <div data-testid="project-empty-view" />,
}));

import { ProjectRootRedirectView } from "./ProjectRootRedirectView";

function MobileRouteTarget() {
  return <div data-testid="mobile-agents-route" />;
}

function renderView() {
  return render(
    <MemoryRouter initialEntries={["/projects/p1"]}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectRootRedirectView />} />
        <Route path="/projects/:projectId/agents" element={<MobileRouteTarget />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProjectRootRedirectView", () => {
  beforeEach(() => {
    mockCapabilities.isMobileLayout = false;
    mockProjectsListState.agentsByProject = {};
    mockProjectsListState.loadingAgentsByProject = {};
  });

  it("waits for agent resolution before showing the empty project view", () => {
    renderView();

    expect(screen.queryByTestId("project-empty-view")).not.toBeInTheDocument();
  });

  it("waits while the project agent list is still loading", () => {
    mockProjectsListState.agentsByProject = { p1: [] };
    mockProjectsListState.loadingAgentsByProject = { p1: true };

    renderView();

    expect(screen.queryByTestId("project-empty-view")).not.toBeInTheDocument();
  });

  it("shows the empty project view after the project agent list resolves empty", () => {
    mockProjectsListState.agentsByProject = { p1: [] };

    renderView();

    expect(screen.getByTestId("project-empty-view")).toBeInTheDocument();
  });

  it("redirects mobile layouts straight to the project agents route", () => {
    mockCapabilities.isMobileLayout = true;

    renderView();

    expect(screen.getByTestId("mobile-agents-route")).toBeInTheDocument();
  });
});
