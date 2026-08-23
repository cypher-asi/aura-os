import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";

const mockNavigate = vi.fn();
const openOrgSettings = vi.fn();
const openDownloads = vi.fn();
const openChangelog = vi.fn();
const openCreateAgentModal = vi.fn();
const openNewProjectModal = vi.fn();
const toggleSidekick = vi.fn();
const reopenChecklist = vi.fn();
const dismissChecklist = vi.fn();
const trackMock = vi.fn();
const windowCommandMock = vi.fn();
const logoutMock = vi.fn();
const openQuickPrompt = vi.fn();
let isAuthenticatedMock = false;

vi.mock("../../stores/auth-store", () => ({
  useAuth: () => ({ isAuthenticated: isAuthenticatedMock }),
}));

vi.mock("../../stores/use-logout", () => ({
  useLogout: () => logoutMock,
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual<typeof import("react-router-dom")>("react-router-dom");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

vi.mock("../../stores/ui-modal-store", () => ({
  useUIModalStore: Object.assign(
    (
      selector?: (state: {
        openOrgSettings: typeof openOrgSettings;
        openDownloads: typeof openDownloads;
        openChangelog: typeof openChangelog;
      }) => unknown,
    ) => {
      const state = { openOrgSettings, openDownloads, openChangelog };
      return selector ? selector(state) : state;
    },
    {
      getState: () => ({ openOrgSettings, openDownloads, openChangelog }),
    },
  ),
}));

vi.mock("../../apps/agents/stores/agent-store", () => ({
  useAgentStore: Object.assign(
    () => ({}),
    {
      getState: () => ({ openCreateAgentModal, agents: [] }),
    },
  ),
}));

vi.mock("../../stores/projects-list-store", () => ({
  useProjectsListStore: Object.assign(
    () => ({}),
    {
      getState: () => ({ openNewProjectModal, agentsByProject: {} }),
    },
  ),
}));

vi.mock("../../stores/app-ui-store", () => ({
  useAppUIStore: Object.assign(
    () => ({}),
    {
      getState: () => ({ toggleSidekick }),
    },
  ),
}));

vi.mock("../../stores/quick-prompt-store", () => ({
  useQuickPromptStore: {
    getState: () => ({ open: openQuickPrompt }),
  },
}));

vi.mock("../../features/onboarding/onboarding-store", () => ({
  useOnboardingStore: Object.assign(
    () => ({}),
    {
      getState: () => ({
        reopenChecklist,
        dismissChecklist,
        checklistDismissed: true,
      }),
    },
  ),
}));

vi.mock("../../lib/windowCommand", () => ({
  windowCommand: (...args: unknown[]) => windowCommandMock(...args),
}));

vi.mock("../../lib/analytics", () => ({
  track: (...args: unknown[]) => trackMock(...args),
}));

vi.mock("../../lib/zoom", () => ({
  zoomIn: vi.fn(),
  zoomOut: vi.fn(),
  resetZoom: vi.fn(),
}));

import { MenuBar } from "./MenuBar";
import { MenuShortcuts } from "./MenuShortcuts";
import { __setIsMacForTesting } from "../../lib/platform";

function renderMenuBar() {
  return render(
    <MemoryRouter>
      <MenuBar />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  __setIsMacForTesting(false);
  document.documentElement.dataset.theme = "dark";
  isAuthenticatedMock = false;
});

afterEach(() => {
  vi.clearAllMocks();
  __setIsMacForTesting(null);
  delete document.documentElement.dataset.theme;
});

describe("MenuBar", () => {
  it("renders File / Edit / View / Help triggers", () => {
    renderMenuBar();
    expect(screen.getByRole("menuitem", { name: "File" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "View" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Help" })).toBeInTheDocument();
  });

  it("opens File menu and shows Settings shortcut formatted for Windows", async () => {
    const user = userEvent.setup();
    renderMenuBar();
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    expect(screen.getByRole("menu", { name: "File" })).toBeInTheDocument();
    expect(screen.getByText("Settings")).toBeInTheDocument();
    expect(screen.getByText("Ctrl+,")).toBeInTheDocument();
  });

  it("marks the open trigger as selected via data-open + class for distinct background", async () => {
    const user = userEvent.setup();
    renderMenuBar();
    const fileTrigger = screen.getByRole("menuitem", { name: "File" });
    expect(fileTrigger).toHaveAttribute("aria-expanded", "false");
    expect(fileTrigger).not.toHaveAttribute("data-open");
    await user.click(fileTrigger);
    expect(fileTrigger).toHaveAttribute("aria-expanded", "true");
    expect(fileTrigger).toHaveAttribute("data-open", "true");
    expect(fileTrigger.className).toMatch(/triggerOpen/);
  });

  it("renders Mac glyphs for shortcuts on macOS", async () => {
    __setIsMacForTesting(true);
    const user = userEvent.setup();
    renderMenuBar();
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    expect(screen.getByText("⌘N")).toBeInTheDocument();
    expect(screen.getByText("⇧⌘N")).toBeInTheDocument();
  });

  it("hover-switches between menus while one is open", async () => {
    const user = userEvent.setup();
    renderMenuBar();
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    expect(screen.getByRole("menu", { name: "File" })).toBeInTheDocument();
    fireEvent.pointerEnter(screen.getByRole("menuitem", { name: "Edit" }));
    expect(screen.getByRole("menu", { name: "Edit" })).toBeInTheDocument();
  });

  it("File > Settings dispatches openOrgSettings", async () => {
    const user = userEvent.setup();
    renderMenuBar();
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    await user.click(screen.getByRole("menuitem", { name: /Settings/ }));
    expect(openOrgSettings).toHaveBeenCalledTimes(1);
  });

  it("File > Quick Prompt opens the global prompt palette", async () => {
    const user = userEvent.setup();
    renderMenuBar();
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    await user.click(screen.getByRole("menuitem", { name: /Quick Prompt/ }));
    expect(openQuickPrompt).toHaveBeenCalledWith(null);
  });

  it("opens Quick Prompt with Ctrl+Shift+Space", () => {
    render(
      <MemoryRouter>
        <MenuShortcuts />
      </MemoryRouter>,
    );
    fireEvent.keyDown(document, { key: " ", ctrlKey: true, shiftKey: true });
    expect(openQuickPrompt).toHaveBeenCalledWith(null);
  });

  it("File > Exit posts the close IPC", async () => {
    const user = userEvent.setup();
    renderMenuBar();
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    await user.click(screen.getByRole("menuitem", { name: /Exit/ }));
    expect(windowCommandMock).toHaveBeenCalledWith("close");
  });

  it("Help > Downloads opens the in-app modal when logged in", async () => {
    isAuthenticatedMock = true;
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();
    renderMenuBar();
    await user.click(screen.getByRole("menuitem", { name: "Help" }));
    await user.click(screen.getByRole("menuitem", { name: /Downloads/ }));
    expect(openDownloads).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("Help > Changelog opens the in-app modal", async () => {
    isAuthenticatedMock = true;
    const user = userEvent.setup();
    renderMenuBar();
    await user.click(screen.getByRole("menuitem", { name: "Help" }));
    await user.click(screen.getByRole("menuitem", { name: /Changelog/ }));
    expect(openChangelog).toHaveBeenCalledTimes(1);
  });

  it("Help > Observability navigates in-app when logged in", async () => {
    isAuthenticatedMock = true;
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();
    renderMenuBar();
    await user.click(screen.getByRole("menuitem", { name: "Help" }));
    await user.click(screen.getByRole("menuitem", { name: /^Observability$/ }));
    expect(mockNavigate).toHaveBeenCalledWith("/observability");
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("Help > Downloads opens aura.ai/download in a new tab when logged out", async () => {
    isAuthenticatedMock = false;
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();
    renderMenuBar();
    await user.click(screen.getByRole("menuitem", { name: "Help" }));
    await user.click(screen.getByRole("menuitem", { name: /Downloads/ }));
    expect(openSpy).toHaveBeenCalledWith(
      "https://aura.ai/download",
      "_blank",
      "noopener,noreferrer",
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("Help > Observability opens aura.ai/observability in a new tab when logged out", async () => {
    isAuthenticatedMock = false;
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    const user = userEvent.setup();
    renderMenuBar();
    await user.click(screen.getByRole("menuitem", { name: "Help" }));
    await user.click(screen.getByRole("menuitem", { name: /^Observability$/ }));
    expect(openSpy).toHaveBeenCalledWith(
      "https://aura.ai/observability",
      "_blank",
      "noopener,noreferrer",
    );
    expect(mockNavigate).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("View > Toggle Sidekick calls toggleSidekick", async () => {
    const user = userEvent.setup();
    renderMenuBar();
    await user.click(screen.getByRole("menuitem", { name: "View" }));
    await user.click(screen.getByRole("menuitem", { name: /Toggle Sidekick/ }));
    expect(toggleSidekick).toHaveBeenCalledTimes(1);
  });

  it("disables Previous/Next Agent outside agent routes", async () => {
    const user = userEvent.setup();
    renderMenuBar();
    await user.click(screen.getByRole("menuitem", { name: "View" }));
    const prev = screen.getByRole("menuitem", { name: /Previous Agent/ });
    const next = screen.getByRole("menuitem", { name: /Next Agent/ });
    expect(prev).toBeDisabled();
    expect(next).toBeDisabled();
  });

  it("Esc closes the open menu", async () => {
    const user = userEvent.setup();
    renderMenuBar();
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    expect(screen.getByRole("menu", { name: "File" })).toBeInTheDocument();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu", { name: "File" })).not.toBeInTheDocument();
  });

  it("works under both light and dark themes (no inline color styles applied)", async () => {
    const user = userEvent.setup();
    document.documentElement.dataset.theme = "light";
    renderMenuBar();
    await user.click(screen.getByRole("menuitem", { name: "File" }));
    const panel = screen.getByRole("menu", { name: "File" });
    expect(panel).toBeInTheDocument();
    expect(panel.style.background).toBe("");
    expect(panel.style.color).toBe("");

    document.documentElement.dataset.theme = "dark";
    expect(panel).toBeInTheDocument();
    expect(panel.style.background).toBe("");
    expect(panel.style.color).toBe("");
  });
});
