import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";

const { mockListSkills } = vi.hoisted(() => ({
  mockListSkills: vi.fn(),
}));

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  Badge: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../../api/client", () => ({
  api: {
    harnessSkills: {
      listSkills: (...args: any[]) => mockListSkills(...args),
    },
  },
}));

vi.mock("../stores/agent-sidekick-store", () => ({
  useAgentSidekickStore: (selector: any) => {
    if (typeof selector === "function") return selector({ viewSkill: vi.fn() });
    return { viewSkill: vi.fn() };
  },
}));

vi.mock("./AgentInfoPanel.module.css", () => ({
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
    render(<SkillsTab agent={baseAgent} />);
    expect(screen.getByText(/loading skills/i)).toBeDefined();
  });

  it("renders skill rows on success", async () => {
    mockListSkills.mockResolvedValue([
      { name: "deploy", description: "Deploy app", source: "workspace" },
      { name: "test", description: "Run tests", source: "personal" },
    ]);
    render(<SkillsTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText("deploy")).toBeDefined();
      expect(screen.getByText("test")).toBeDefined();
    });
  });

  it("falls back to badges on error when agent has skills", async () => {
    mockListSkills.mockRejectedValue(new Error("Network error"));
    const agentWithSkills = { ...baseAgent, skills: ["deploy", "test"] };
    render(<SkillsTab agent={agentWithSkills} />);
    await waitFor(() => {
      expect(screen.getByText("deploy")).toBeDefined();
      expect(screen.getByText("test")).toBeDefined();
    });
  });

  it("shows empty state when no skills", async () => {
    mockListSkills.mockRejectedValue(new Error("fail"));
    render(<SkillsTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText(/no skills configured/i)).toBeDefined();
    });
  });

  it("renders empty list from API as empty state", async () => {
    mockListSkills.mockResolvedValue([]);
    render(<SkillsTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText(/no skills configured/i)).toBeDefined();
    });
  });
});
