import { renderHook, act } from "@testing-library/react";
import { useNewProjectForm } from "./use-new-project-form";

const mockUseAuraCapabilities = vi.fn();

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

vi.mock("./use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
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
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });
  });

  it("returns initial state with empty form fields", () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    expect(result.current.name).toBe("");
    expect(result.current.folderPath).toBe("");
    expect(result.current.environment).toBe("remote");
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBe("");
  });

  it("setName updates the name and auto-derives folderPath", () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    act(() => {
      result.current.setName("New Project");
    });

    expect(result.current.name).toBe("New Project");
    expect(result.current.folderPath).toBe("p/new-project");
  });

  it("auto-derived folderPath stops updating after manual edit", () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    act(() => {
      result.current.setName("First");
    });
    expect(result.current.folderPath).toBe("p/first");

    act(() => {
      result.current.setFolderPath("/custom/path");
    });
    expect(result.current.folderPath).toBe("/custom/path");

    act(() => {
      result.current.setName("Second");
    });
    expect(result.current.folderPath).toBe("/custom/path");
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
  });

  it("handleClose resets form and calls onClose", () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    act(() => {
      result.current.setName("test");
    });

    act(() => {
      result.current.handleClose();
    });

    expect(result.current.name).toBe("");
    expect(result.current.folderPath).toBe("");
    expect(result.current.environment).toBe("remote");
    expect(mockOnClose).toHaveBeenCalled();
  });

  it("setEnvironment updates the environment", () => {
    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    expect(result.current.environment).toBe("remote");

    act(() => {
      result.current.setEnvironment("local");
    });

    expect(result.current.environment).toBe("local");
  });

  it("keeps mobile projects remote-only even if local is requested", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    const { result } = renderHook(() =>
      useNewProjectForm(true, mockOnClose, mockOnCreated),
    );

    expect(result.current.environment).toBe("remote");

    act(() => {
      result.current.setEnvironment("local");
    });

    expect(result.current.environment).toBe("remote");
  });
});
