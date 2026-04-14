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
    environment: "production",
    adapter_type: "codex",
    auth_source: "integration",
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

  it("keeps desktop profile compact while still showing skill tags", async () => {
    render(<ProfileTab {...baseProps} />);

    await waitFor(() => {
      expect(screen.getByText("deploy")).toBeInTheDocument();
    });

    expect(screen.queryByText("Installed Skills")).not.toBeInTheDocument();
    expect(screen.queryByText("Remote Runtime")).not.toBeInTheDocument();
  });

  it("shows remote runtime and installed skills on mobile standalone", async () => {
    render(<ProfileTab {...baseProps} isMobileStandalone />);

    await waitFor(() => {
      expect(screen.getByText("Installed Skills")).toBeInTheDocument();
    });

    expect(screen.getByText("Remote Runtime")).toBeInTheDocument();
    expect(screen.getByText("Remote agent is running")).toBeInTheDocument();
    expect(screen.getAllByText("deploy")).toHaveLength(2);
    expect(screen.getByRole("button", { name: /deploy/i })).toBeInTheDocument();
  });
});
