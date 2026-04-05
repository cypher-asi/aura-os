import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";

const { mockListSkills, mockListAgentSkills } = vi.hoisted(() => ({
  mockListSkills: vi.fn(),
  mockListAgentSkills: vi.fn(),
}));

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => (
    <button onClick={onClick}>{children}</button>
  ),
  Modal: ({ isOpen, children, footer }: any) =>
    isOpen ? <div data-testid="modal">{children}{footer}</div> : null,
  Input: (props: any) => <input {...props} />,
}));

vi.mock("../../../api/client", () => ({
  api: {
    harnessSkills: {
      listSkills: (...args: any[]) => mockListSkills(...args),
      listAgentSkills: (...args: any[]) => mockListAgentSkills(...args),
      createSkill: vi.fn().mockResolvedValue({}),
      installAgentSkill: vi.fn().mockResolvedValue({}),
      uninstallAgentSkill: vi.fn().mockResolvedValue(undefined),
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
  });

  it("shows loading state initially", () => {
    mockListSkills.mockReturnValue(new Promise(() => {}));
    mockListAgentSkills.mockReturnValue(new Promise(() => {}));
    render(<SkillsTab agent={baseAgent} />);
    expect(screen.getByText(/loading/i)).toBeDefined();
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
});
