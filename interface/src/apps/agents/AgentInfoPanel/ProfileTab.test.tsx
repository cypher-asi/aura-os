import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Agent } from "../../../shared/types";

const { mockListAgentSkills, mockUseRemoteAgentState, mockUseRemoteAgentVm, mockHandleAction } = vi.hoisted(() => ({
  mockListAgentSkills: vi.fn(),
  mockUseRemoteAgentState: vi.fn(),
  mockUseRemoteAgentVm: vi.fn(),
  mockHandleAction: vi.fn(async () => {}),
}));

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
}));

vi.mock("../../../api/client", () => ({
  api: {
    harnessSkills: {
      listAgentSkills: (...args: unknown[]) => mockListAgentSkills(...args),
    },
    channels: {
      listChannels: vi.fn().mockResolvedValue({ channels: [] }),
    },
  },
}));

vi.mock("../../../hooks/use-remote-agent-state", () => ({
  useRemoteAgentState: (...args: unknown[]) => mockUseRemoteAgentState(...args),
}));

vi.mock("../components/AgentEnvironment/useRemoteAgentVm", () => ({
  useRemoteAgentVm: (...args: unknown[]) => mockUseRemoteAgentVm(...args),
}));

vi.mock("../../../components/Avatar", () => ({
  Avatar: ({ name }: { name: string }) => <div>{name}</div>,
}));

vi.mock("../../../components/FollowEditButton", () => ({
  FollowEditButton: () => <button>Follow</button>,
}));

// TelegramConnect uses react-query (`useQuery`), which would require a
// QueryClientProvider; it has its own tests, so stub it out here.
vi.mock("../components/TelegramConnect", () => ({
  TelegramConnect: () => null,
}));

vi.mock("./AgentInfoPanel.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { ProfileTab } from "./ProfileTab";

const baseProps = {
  agent: {
    agent_id: "agent-1",
    name: "Remote Builder",
    role: "Builder",
    personality: "Helpful",
    machine_type: "remote",
    environment: "swarm_microvm",
    adapter_type: "aura_harness",
    auth_source: "aura_managed",
    created_at: "2025-01-01T00:00:00Z",
    user_id: "user-1",
    profile_id: "profile-1",
    tags: [],
    system_prompt: "",
  } as Agent,
  isOwnAgent: true,
  onViewSkill: vi.fn(),
};

describe("ProfileTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListAgentSkills.mockResolvedValue([
      {
        agent_id: "agent-1",
        skill_name: "deploy",
        source_url: null,
        installed_at: "2025-01-01",
        version: null,
        approved_paths: [],
        approved_commands: [],
      },
    ]);
    mockUseRemoteAgentState.mockReturnValue({
      data: {
        state: "running",
        uptime_seconds: 3660,
        active_sessions: 2,
        endpoint: "vm.example.com",
        runtime_version: "1.2.3",
      },
      loading: false,
      error: null,
    });
    mockUseRemoteAgentVm.mockReturnValue({
      vmState: {
        state: "running",
        uptime_seconds: 3660,
        active_sessions: 2,
        endpoint: "vm.example.com",
        runtime_version: "1.2.3",
      },
      remoteStateError: null,
      remoteStateRecoverable: true,
      recoveryNotice: null,
      pendingRecovery: false,
      actionLoading: null,
      actionError: null,
      handleAction: mockHandleAction,
    });
  });

  it("keeps desktop profile compact without skill tags", async () => {
    render(<ProfileTab {...baseProps} />);

    await waitFor(() => {
      expect(mockListAgentSkills).toHaveBeenCalledWith("agent-1");
    });

    expect(screen.queryByText("deploy")).not.toBeInTheDocument();
    expect(screen.queryByText("Installed Skills")).not.toBeInTheDocument();
    expect(screen.queryByText("Remote Runtime")).not.toBeInTheDocument();
  });

  it("shows the agent's smart-wallet address (truncated) when present", () => {
    render(
      <ProfileTab
        {...baseProps}
        agent={{
          ...baseProps.agent,
          wallet_address: "0x94695c64F52cCFc7a6dC2Ea68Af41A82C5E7412f",
        }}
      />,
    );
    expect(screen.getByText("Wallet")).toBeInTheDocument();
    expect(screen.getByText(/0x9469.*412f/)).toBeInTheDocument();
  });

  it("omits the wallet row when the agent has no wallet address", () => {
    render(<ProfileTab {...baseProps} />);
    expect(screen.queryByText("Wallet")).not.toBeInTheDocument();
  });

  it("shows remote runtime and installed skills on mobile standalone", async () => {
    render(<ProfileTab {...baseProps} isMobileStandalone />);

    await waitFor(() => {
      expect(screen.getByText("Installed Skills")).toBeInTheDocument();
    });

    expect(screen.getByText("Remote Runtime")).toBeInTheDocument();
    expect(screen.getByText("Remote agent is running")).toBeInTheDocument();
    // The skill renders once, as the tappable row in Installed Skills
    // (the profile spec card shows only the section count now).
    expect(screen.getAllByText("deploy")).toHaveLength(1);
    expect(screen.getByRole("button", { name: /deploy/i })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Remote runtime controls" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Hibernate/i }));
    expect(mockHandleAction).toHaveBeenCalledWith("hibernate");
  });

  it("offers recovery on mobile when the remote runtime is unavailable", () => {
    mockUseRemoteAgentVm.mockReturnValue({
      vmState: null,
      remoteStateError: "Gateway unavailable",
      remoteStateRecoverable: true,
      recoveryNotice: null,
      pendingRecovery: false,
      actionLoading: null,
      actionError: null,
      handleAction: mockHandleAction,
    });

    render(<ProfileTab {...baseProps} isMobileStandalone />);

    expect(screen.getByText("Remote agent unavailable")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Recovery" }));
    expect(mockHandleAction).toHaveBeenCalledWith("recover");
  });

  it("hides stale runtime controls after a non-recoverable state error", () => {
    mockUseRemoteAgentVm.mockReturnValue({
      vmState: {
        state: "error",
        uptime_seconds: 3660,
        active_sessions: 2,
        endpoint: "vm.example.com",
        runtime_version: "1.2.3",
        error_message: "Your session expired. Sign in again.",
      },
      remoteStateError: "Your session expired. Sign in again.",
      remoteStateRecoverable: false,
      recoveryNotice: null,
      pendingRecovery: false,
      actionLoading: null,
      actionError: null,
      handleAction: mockHandleAction,
    });

    render(<ProfileTab {...baseProps} isMobileStandalone />);

    expect(screen.getAllByText("Your session expired. Sign in again.")).toHaveLength(1);
    expect(screen.queryByRole("group", { name: "Remote runtime controls" }))
      .not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recovery" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Stop" })).not.toBeInTheDocument();
  });

  it("keeps remote runtime controls read-only for an agent the viewer does not own", () => {
    render(<ProfileTab {...baseProps} isOwnAgent={false} isMobileStandalone />);

    expect(screen.getByText("Remote agent is running")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Remote runtime controls" }))
      .not.toBeInTheDocument();
  });
});
