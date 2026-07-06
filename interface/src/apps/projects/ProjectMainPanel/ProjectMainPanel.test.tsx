import { beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "../../../test/render";
import { useSidekickStore } from "../../../stores/sidekick-store";
import { SIDEKICK_ACTIVE_TAB_KEY } from "../../../constants";

const mockUseTerminalTarget = vi.fn();
const mockSetTerminalTarget = vi.fn();
const mockClearTerminalTarget = vi.fn();
let mockLinkedWorkspace = true;

vi.mock("../../../hooks/use-terminal-target", () => ({
  useTerminalTarget: (args: unknown) => mockUseTerminalTarget(args),
}));

vi.mock("../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({
    features: { linkedWorkspace: mockLinkedWorkspace },
  }),
}));

vi.mock("../../../stores/terminal-panel-store", () => ({
  useTerminalPanelStore: (selector: (state: {
    setTerminalTarget: typeof mockSetTerminalTarget;
    clearTerminalTarget: typeof mockClearTerminalTarget;
  }) => unknown) =>
    selector({
      setTerminalTarget: mockSetTerminalTarget,
      clearTerminalTarget: mockClearTerminalTarget,
    }),
}));

import { ProjectMainPanel } from "./ProjectMainPanel";

describe("ProjectMainPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockLinkedWorkspace = true;
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: undefined,
      remoteAgentInstanceId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: "/Users/demo/project",
      status: "ready",
    });
    window.localStorage.clear();
    useSidekickStore.setState({ activeTab: "terminal" });
  });

  it("resets the sidekick active tab to terminal on entry, overriding a stale persisted value", () => {
    window.localStorage.setItem(SIDEKICK_ACTIVE_TAB_KEY, "sessions");
    useSidekickStore.setState({ activeTab: "sessions" });

    render(<ProjectMainPanel />);

    expect(useSidekickStore.getState().activeTab).toBe("terminal");
    expect(window.localStorage.getItem(SIDEKICK_ACTIVE_TAB_KEY)).toBe("terminal");
    expect(mockSetTerminalTarget).toHaveBeenCalledWith({
      cwd: "/Users/demo/project",
      remoteAgentId: undefined,
      projectId: undefined,
    });
  });

  it("does not re-force terminal on subsequent renders within the same mount", () => {
    const { rerender } = render(<ProjectMainPanel />);
    expect(useSidekickStore.getState().activeTab).toBe("terminal");

    useSidekickStore.getState().setActiveTab("sessions");
    expect(useSidekickStore.getState().activeTab).toBe("sessions");

    rerender(<ProjectMainPanel />);

    expect(useSidekickStore.getState().activeTab).toBe("sessions");
  });

  it("starts on chats and clears terminal target when web cannot reach a local workspace", () => {
    mockLinkedWorkspace = false;
    window.localStorage.setItem(SIDEKICK_ACTIVE_TAB_KEY, "terminal");
    useSidekickStore.setState({ activeTab: "terminal" });

    render(<ProjectMainPanel />);

    expect(useSidekickStore.getState().activeTab).toBe("sessions");
    expect(mockClearTerminalTarget).toHaveBeenCalledWith(undefined);
    expect(mockSetTerminalTarget).not.toHaveBeenCalled();
  });

  it("keeps remote workspaces on terminal", () => {
    mockLinkedWorkspace = false;
    mockUseTerminalTarget.mockReturnValue({
      remoteAgentId: "remote-agent-1",
      remoteAgentInstanceId: "remote-inst-1",
      remoteWorkspacePath: "/workspace/project",
      workspacePath: "/workspace/project",
      status: "ready",
    });
    window.localStorage.setItem(SIDEKICK_ACTIVE_TAB_KEY, "sessions");
    useSidekickStore.setState({ activeTab: "sessions" });

    render(<ProjectMainPanel />);

    expect(useSidekickStore.getState().activeTab).toBe("terminal");
    expect(mockSetTerminalTarget).toHaveBeenCalledWith({
      cwd: "/workspace/project",
      remoteAgentId: "remote-agent-1",
      projectId: undefined,
    });
  });
});
