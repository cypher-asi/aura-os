import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

const {
  mockListSkills,
  mockListAgentSkills,
  mockListMySkills,
  mockDeleteMySkill,
  mockUninstallAgentSkill,
} = vi.hoisted(() => ({
  mockListSkills: vi.fn(),
  mockListAgentSkills: vi.fn(),
  mockListMySkills: vi.fn(),
  mockDeleteMySkill: vi.fn(),
  mockUninstallAgentSkill: vi.fn(),
}));

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Modal: ({ isOpen, children, footer }: any) =>
    isOpen ? <div data-testid="modal">{children}{footer}</div> : null,
  Input: (props: any) => <input {...props} />,
  // `ButtonMore` renders a menu; in tests we flatten it to a list of
  // buttons so the "Delete skill" entry is directly clickable.
  ButtonMore: ({ items, onSelect }: any) => (
    <div>
      {items
        ?.filter((i: any) => !i.type)
        .map((i: any) => (
          <button
            key={i.id}
            data-testid={`menu-${i.id}`}
            onClick={() => onSelect(i.id)}
          >
            {i.label}
          </button>
        ))}
    </div>
  ),
}));

vi.mock("../../../api/client", () => ({
  api: {
    harnessSkills: {
      listSkills: (...args: any[]) => mockListSkills(...args),
      listAgentSkills: (...args: any[]) => mockListAgentSkills(...args),
      listMySkills: (...args: any[]) => mockListMySkills(...args),
      deleteMySkill: (...args: any[]) => mockDeleteMySkill(...args),
      createSkill: vi.fn().mockResolvedValue({}),
      installAgentSkill: vi.fn().mockResolvedValue({}),
      uninstallAgentSkill: (...args: any[]) => mockUninstallAgentSkill(...args),
    },
  },
}));

vi.mock("../stores/agent-sidekick-store", () => ({
  useAgentSidekickStore: (selector: any) => {
    if (typeof selector === "function") return selector({ viewSkill: vi.fn() });
    return { viewSkill: vi.fn() };
  },
}));

vi.mock("./CreateSkillModal", () => ({
  CreateSkillModal: () => null,
}));

vi.mock("../../../components/SkillShopModal", () => ({
  SkillShopModal: () => null,
}));

vi.mock("./SkillsTab.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { SkillsTab } from "./SkillsTab";

const baseAgent = {
  agent_id: "a1",
  name: "Test Agent",
  skills: [],
} as any;

describe("SkillsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListMySkills.mockResolvedValue([]);
    mockDeleteMySkill.mockResolvedValue({ name: "", deleted: true });
    mockUninstallAgentSkill.mockResolvedValue(undefined);
  });

  it("shows loading state initially", () => {
    mockListSkills.mockReturnValue(new Promise(() => {}));
    mockListAgentSkills.mockReturnValue(new Promise(() => {}));
    mockListMySkills.mockReturnValue(new Promise(() => {}));
    render(<SkillsTab agent={baseAgent} />);
    expect(screen.getByText("Installed")).toBeDefined();
    expect(screen.getByTitle("Create skill")).toBeDefined();
  });

  it("renders installed and available skills correctly", async () => {
    mockListSkills.mockResolvedValue([
      { name: "deploy", description: "Deploy app", source: "workspace" },
      { name: "test", description: "Run tests", source: "personal" },
      { name: "lint", description: "Lint code", source: "workspace" },
    ]);
    mockListAgentSkills.mockResolvedValue([
      { agent_id: "a1", skill_name: "deploy", source_url: null, installed_at: "2025-01-01", version: null },
    ]);
    render(<SkillsTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText("Installed (1)")).toBeDefined();
      expect(screen.getByText("deploy")).toBeDefined();
      expect(screen.getByText("Available (2)")).toBeDefined();
    });
  });

  it("shows empty installed state", async () => {
    mockListSkills.mockResolvedValue([
      { name: "deploy", description: "Deploy app", source: "workspace" },
    ]);
    mockListAgentSkills.mockResolvedValue([]);
    render(<SkillsTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText("Installed (0)")).toBeDefined();
      expect(screen.getByText("No skills installed")).toBeDefined();
    });
  });

  it("handles both APIs returning empty gracefully", async () => {
    mockListSkills.mockResolvedValue([]);
    mockListAgentSkills.mockResolvedValue([]);
    render(<SkillsTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText("Installed (0)")).toBeDefined();
      expect(screen.getByText("No skills installed")).toBeDefined();
      expect(screen.getByText("Available (0)")).toBeDefined();
    });
  });

  it("shows blocking agents when server refuses delete with 409", async () => {
    mockListSkills.mockResolvedValue([]);
    mockListAgentSkills.mockResolvedValue([]);
    mockListMySkills.mockResolvedValue([
      {
        name: "cascade-skill",
        description: "",
        path: "/tmp/cascade-skill/SKILL.md",
        user_invocable: true,
        model_invocable: false,
      },
    ]);
    mockDeleteMySkill.mockRejectedValue({
      status: 409,
      body: {
        error: "installed_on_agents",
        message: "Uninstall this skill from all agents before deleting it.",
        agents: [
          { agent_id: "ceo-1", name: "CEO Agent" },
          { agent_id: "a2", name: "Agent02" },
        ],
      },
    });

    render(<SkillsTab agent={baseAgent} />);

    await waitFor(() => {
      expect(screen.getByText("cascade-skill")).toBeDefined();
    });

    fireEvent.click(screen.getByTestId("menu-delete"));

    const deleteBtn = await screen.findByText("Delete");
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    await waitFor(() => {
      expect(screen.getByText("Still installed on:")).toBeDefined();
      expect(screen.getByText("CEO Agent")).toBeDefined();
      expect(screen.getByText("Agent02")).toBeDefined();
    });

    // Regression: we must not quietly uninstall from the current agent.
    // That would mask the real "installed elsewhere" state from the user.
    expect(mockUninstallAgentSkill).not.toHaveBeenCalled();
  });

  it("does not pre-uninstall from current agent on successful delete", async () => {
    mockListSkills.mockResolvedValue([]);
    mockListAgentSkills.mockResolvedValue([
      {
        agent_id: "a1",
        skill_name: "solo-skill",
        source_url: null,
        installed_at: "2025-01-01",
        version: null,
        approved_paths: [],
        approved_commands: [],
      },
    ]);
    mockListMySkills.mockResolvedValue([
      {
        name: "solo-skill",
        description: "",
        path: "/tmp/solo-skill/SKILL.md",
        user_invocable: true,
        model_invocable: false,
      },
    ]);
    mockDeleteMySkill.mockResolvedValue({ name: "solo-skill", deleted: true });

    render(<SkillsTab agent={baseAgent} />);

    await waitFor(() => {
      // Two rows render the same skill name (one under Installed, one
      // under My Skills) — the one under My Skills is what owns the
      // "Delete skill" menu entry we're about to click.
      expect(screen.getAllByText("solo-skill").length).toBeGreaterThan(0);
    });

    const deleteMenuButtons = screen.getAllByTestId("menu-delete");
    fireEvent.click(deleteMenuButtons[0]);

    const deleteBtn = await screen.findByText("Delete");
    await act(async () => {
      fireEvent.click(deleteBtn);
    });

    await waitFor(() => {
      expect(mockDeleteMySkill).toHaveBeenCalledWith("solo-skill");
    });
    expect(mockUninstallAgentSkill).not.toHaveBeenCalled();
  });
});
