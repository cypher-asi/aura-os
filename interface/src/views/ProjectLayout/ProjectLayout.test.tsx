import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectLayout } from "./ProjectLayout";

const useProjectLayoutDataMock = vi.fn();
const useOrgStoreMock = vi.fn();
const navigateMock = vi.fn();

vi.mock("./useProjectLayoutData", () => ({
  useProjectLayoutData: () => useProjectLayoutDataMock(),
}));

vi.mock("@cypher-asi/zui", () => ({
  PageEmptyState: ({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }) => (
    <div>
      <div>{title}</div>
      <div>{description}</div>
      {actions}
    </div>
  ),
  Button: ({ children, onClick }: { children: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
}));

vi.mock("../../stores/org-store", () => ({
  useOrgStore: (selector: (state: { activeOrg: { org_id: string } | null }) => unknown) =>
    useOrgStoreMock(selector),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    Outlet: () => <div>Project Work</div>,
    useNavigate: () => navigateMock,
    useParams: () => ({ projectId: "proj-1" }),
  };
});

describe("ProjectLayout", () => {
  beforeEach(() => {
    useProjectLayoutDataMock.mockReset();
    useOrgStoreMock.mockReset();
    navigateMock.mockReset();
  });

  it("renders the project content when the project exists", () => {
    useProjectLayoutDataMock.mockReturnValue({
      displayProject: { project_id: "proj-1", name: "Project One" },
      initialSpecs: [],
      initialTasks: [],
      loading: false,
      projects: [{ project_id: "proj-1", name: "Project One" }],
    });
    useOrgStoreMock.mockImplementation((selector: (state: { activeOrg: { org_id: string } | null }) => unknown) =>
      selector({ activeOrg: { org_id: "org-1" } }),
    );

    render(<ProjectLayout />);

    expect(screen.getByText("Project Work")).toBeInTheDocument();
  });

  it("redirects back to projects when the active org changes and the current project disappears", async () => {
    let activeOrgId = "org-1";
    useOrgStoreMock.mockImplementation((selector: (state: { activeOrg: { org_id: string } | null }) => unknown) =>
      selector({ activeOrg: activeOrgId ? { org_id: activeOrgId } : null }),
    );

    useProjectLayoutDataMock.mockImplementation(() => ({
      displayProject: activeOrgId === "org-1" ? { project_id: "proj-1", name: "Project One" } : null,
      initialSpecs: [],
      initialTasks: [],
      loading: false,
      projects: activeOrgId === "org-1"
        ? [{ project_id: "proj-1", name: "Project One" }]
        : [{ project_id: "proj-2", name: "Project Two" }],
    }));

    const view = render(<ProjectLayout />);
    expect(screen.getByText("Project Work")).toBeInTheDocument();

    activeOrgId = "org-2";
    view.rerender(<ProjectLayout />);

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/projects", { replace: true });
    });
  });
});
