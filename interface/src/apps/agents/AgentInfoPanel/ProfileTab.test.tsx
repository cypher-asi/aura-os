import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";

const { mockListAgentSkills, mockUseRemoteAgentState } = vi.hoisted(() => ({
  mockListAgentSkills: vi.fn(),
  mockUseRemoteAgentState: vi.fn(),
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
      listAgentSkills: (...args: any[]) => mockListAgentSkills(...args),
    },
    channels: {
      listChannels: vi.fn().mockResolvedValue({ channels: [] }),
    },
  },
}));

vi.mock("../../../hooks/use-remote-agent-state", () => ({
  useRemoteAgentState: (...args: any[]) => mockUseRemoteAgentState(...args),
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
  } as any,
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
  });
});
