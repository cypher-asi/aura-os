import type { ChangeEvent, ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Project } from "../../shared/types";
import { ProjectSettingsModal } from "./ProjectSettingsModal";

const { apiMock } = vi.hoisted(() => ({
  apiMock: {
    getProject: vi.fn(),
    updateProject: vi.fn(),
    listProjectOrbitCollaborators: vi.fn(),
  },
}));

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: string;
    children: ReactNode;
    footer: ReactNode;
  }) =>
    isOpen ? (
      <div>
        <h1>{title}</h1>
        {children}
        {footer}
      </div>
    ) : null,
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button type="button" onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Input: ({
    value,
    onChange,
    placeholder,
    disabled,
  }: {
    value: string;
    onChange?: (event: ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    disabled?: boolean;
  }) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      disabled={disabled}
    />
  ),
  Spinner: () => <span>Loading</span>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../api/client", () => ({ api: apiMock }));
vi.mock("../../hooks/use-workspace-defaults", () => ({
  useWorkspaceRoot: () => "/default/workspaces",
  joinWorkspacePath: (root: string, projectId: string) => `${root}/${projectId}`,
}));
vi.mock("../../hooks/use-orbit-repos", () => ({
  useOrbitRepos: () => ({
    orbitRepos: [],
    orbitReposLoading: false,
  }),
}));
vi.mock("../../stores/org-store", () => ({
  useOrgStore: (selector: (state: { activeOrg: { org_id: string } }) => unknown) =>
    selector({ activeOrg: { org_id: "org-1" } }),
}));
vi.mock("../../stores/auth-store", () => ({
  useAuth: () => ({
    user: { user_id: "user-1" },
    isAuthenticated: true,
  }),
}));
vi.mock("../../apps/projects/useProjectsList", () => ({
  useProjectsList: () => ({ projects: [] }),
}));
vi.mock("../FolderPickerField", () => ({
  FolderPickerField: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <div>
      <span data-testid="workspace-path">{value}</span>
      <button type="button" onClick={() => onChange("D:\\GitHub\\replacement")}>
        Choose replacement folder
      </button>
    </div>
  ),
}));
vi.mock("../OrbitRepoSection", () => ({
  OrbitRepoSection: ({
    setOrbitRepoMode,
  }: {
    setOrbitRepoMode: (mode: "existing") => void;
  }) => (
    <button type="button" onClick={() => setOrbitRepoMode("existing")}>
      Use existing repo
    </button>
  ),
}));

const project = {
  project_id: "project-1",
  org_id: "org-1",
  name: "Detached project",
  description: "",
  current_status: "active",
  created_at: "2026-07-20T00:00:00Z",
  updated_at: "2026-07-20T00:00:00Z",
  git_branch: "main",
  local_workspace_path: "D:\\GitHub\\old-location",
} as Project;

describe("ProjectSettingsModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    apiMock.getProject.mockResolvedValue(project);
    apiMock.updateProject.mockImplementation(
      async (_projectId: string, patch: Partial<Project>) => ({
        ...project,
        ...patch,
      }),
    );
  });

  it("saves a changed workspace without requiring an Orbit repo", async () => {
    const onSaved = vi.fn();
    const onClose = vi.fn();
    render(
      <ProjectSettingsModal
        target={project}
        onSaved={onSaved}
        onClose={onClose}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("workspace-path")).toHaveTextContent(
        "D:\\GitHub\\old-location",
      ),
    );
    expect(
      screen.getByText("No Orbit repo linked. Other project settings can still be saved."),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Choose replacement folder" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(apiMock.updateProject).toHaveBeenCalledTimes(1));
    const patch = apiMock.updateProject.mock.calls[0][1];
    expect(patch.local_workspace_path).toBe("D:\\GitHub\\replacement");
    expect(patch).not.toHaveProperty("orbit_owner");
    expect(patch).not.toHaveProperty("orbit_repo");
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("validates Orbit selection only after linking is explicitly enabled", async () => {
    render(
      <ProjectSettingsModal
        target={project}
        onSaved={() => {}}
        onClose={() => {}}
      />,
    );

    await waitFor(() => expect(screen.getByText("Link an Orbit repo")).toBeInTheDocument());
    fireEvent.click(screen.getByLabelText("Link an Orbit repo"));
    fireEvent.click(screen.getByRole("button", { name: "Use existing repo" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Select an existing Orbit repo to link."),
    ).toBeInTheDocument();
    expect(apiMock.updateProject).not.toHaveBeenCalled();
  });
});
