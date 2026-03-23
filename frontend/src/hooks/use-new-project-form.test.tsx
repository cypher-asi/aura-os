import { renderHook, act } from "@testing-library/react";
import { useNewProjectForm } from "./use-new-project-form";

vi.mock("../stores/org-store", () => ({
  useOrgStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      activeOrg: { org_id: "org-1" },
      isLoading: false,
    }),
}));

vi.mock("../stores/auth-store", () => ({
  useAuth: () => ({
    user: { user_id: "user-1" },
    isAuthenticated: true,
  }),
}));

vi.mock("../apps/projects/useProjectsList", () => ({
  useProjectsList: () => ({
    projects: [{ project_id: "existing", org_id: "org-1" }],
  }),
}));

vi.mock("./use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({
    isMobileLayout: false,
    features: {
      windowControls: false,
      linkedWorkspace: false,
      nativeUpdater: false,
      hostRetargeting: true,
      ideIntegration: false,
    },
  }),
}));

vi.mock("../lib/new-project-draft", () => ({
  clearNewProjectDraftFiles: vi.fn().mockResolvedValue(undefined),
  loadNewProjectDraftFiles: vi.fn().mockResolvedValue([]),
  saveNewProjectDraftFiles: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./use-new-project-draft", () => ({
  useNewProjectDraft: () => ({
    storedDraft: null,
    saveDraft: vi.fn(),
    clearDraft: vi.fn(),
  }),
}));

vi.mock("./use-orbit-repos", () => ({
  useOrbitRepos: () => ({
    orbitRepos: [],
    orbitReposLoading: false,
    resetOrbitRepos: vi.fn(),
  }),
}));

vi.mock("../api/client", () => ({
  api: {
    createProject: vi.fn(),
    importProject: vi.fn(),
    listOrbitRepos: vi.fn().mockResolvedValue([]),
  },
}));

import { api } from "../api/client";

describe("useNewProjectForm", () => {
  const mockOnClose = vi.fn();
  const mockOnCreated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it("returns initial state with empty form fields", () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    expect(result.current.name).toBe("");
    expect(result.current.description).toBe("");
    expect(result.current.workspaceMode).toBe("linked");
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("setName updates the name", () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    act(() => {
      result.current.setName("New Project");
    });

    expect(result.current.name).toBe("New Project");
  });

  it("setDescription updates the description", () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    act(() => {
      result.current.setDescription("A description");
    });

    expect(result.current.description).toBe("A description");
  });

  it("canSubmit is false when name is empty", () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    expect(result.current.canSubmit).toBe(false);
    expect(result.current.submitBlocker).toContain("Project name is required");
  });

  it("proposedRepoSlug derives from name", () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    act(() => {
      result.current.setName("My Cool Project!");
    });

    expect(result.current.proposedRepoSlug).toBe("my-cool-project");
  });

  it("handleSubmit validates name", async () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.nameError).toBe("Project name is required");
    expect(api.createProject).not.toHaveBeenCalled();
    expect(api.importProject).not.toHaveBeenCalled();
  });

  it("handleSubmit validates imported files when in imported mode", async () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    act(() => {
      result.current.setName("Test Project");
    });

    await act(async () => {
      await result.current.handleSubmit();
    });

    expect(result.current.error).toContain("Choose a linked folder");
  });

  it("handleClose resets form and calls onClose", () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    act(() => {
      result.current.setName("test");
      result.current.setDescription("desc");
    });

    act(() => {
      result.current.handleClose();
    });

    expect(result.current.name).toBe("");
    expect(result.current.description).toBe("");
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("handleImportSelection updates candidates", () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    const file = new File(["content"], "test.ts", { type: "text/plain" });
    const fileList = {
      0: file,
      length: 1,
      item: () => file,
      [Symbol.iterator]: function* () { yield file; },
    } as unknown as FileList;

    act(() => {
      result.current.handleImportSelection(fileList);
    });

    expect(result.current.importCandidates).toHaveLength(1);
  });

  it("importSummary computes count and size label", () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    const file = new File(["x".repeat(2048)], "big.ts", { type: "text/plain" });
    const fileList = {
      0: file,
      length: 1,
      item: () => file,
      [Symbol.iterator]: function* () { yield file; },
    } as unknown as FileList;

    act(() => {
      result.current.handleImportSelection(fileList);
    });

    expect(result.current.importSummary.count).toBe(1);
    expect(result.current.importSummary.sizeLabel).toContain("KB");
  });

  it("workspaceModeOptions has only imported when no linkedWorkspace feature", () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    expect(result.current.workspaceModeOptions).toHaveLength(1);
    expect(result.current.workspaceModeOptions[0].id).toBe("imported");
    expect(result.current.showWorkspaceModePicker).toBe(false);
  });
});
