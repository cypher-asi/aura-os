import { render, screen } from "../../test/render";
import { Route, Routes } from "react-router-dom";

const mockUseProjectActions = vi.fn();

vi.mock("../../stores/project-action-store", () => ({
  useProjectActions: () => mockUseProjectActions(),
}));

import { ProjectTasksView } from "./ProjectTasksView";

describe("ProjectTasksView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProjectActions.mockReturnValue({
      project: { project_id: "proj-1" },
    });
  });

  it("redirects desktop project task routes to the desktop Tasks app", () => {
    render(
      <Routes>
        <Route path="/projects/:projectId/tasks" element={<ProjectTasksView />} />
        <Route path="/tasks/:projectId" element={<div>Desktop tasks destination</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/tasks"] } },
    );

    expect(screen.getByText("Desktop tasks destination")).toBeInTheDocument();
  });
});
