import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { mockListSkills } = vi.hoisted(() => ({
  mockListSkills: vi.fn(),
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
  Textarea: (props: any) => <textarea {...props} />,
  Spinner: () => <span>spinner</span>,
}));

vi.mock("../../../api/client", () => ({
  api: {
    harnessSkills: {
      listSkills: (...args: any[]) => mockListSkills(...args),
      createSkill: vi.fn().mockResolvedValue({}),
    },
    agents: {
      update: vi.fn().mockResolvedValue({ agent_id: "a1", skills: [] }),
    },
  },
}));

vi.mock("../stores", () => ({
  useAgentStore: { getState: () => ({ patchAgent: vi.fn() }) },
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

vi.mock("../../../components/AgentEditorModal/AgentEditorModal.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { SkillsTab } from "./SkillsTab";

const baseAgent = {
  agent_id: "a1",
  name: "Test Agent",
  skills: ["orchestration", "fleet-management"],
} as any;

describe("SkillsTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders agent skill tags", async () => {
    mockListSkills.mockResolvedValue([]);
    render(<SkillsTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText("orchestration")).toBeDefined();
      expect(screen.getByText("fleet-management")).toBeDefined();
    });
  });

  it("renders harness skill rows on success", async () => {
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

  it("shows harness error without hiding agent skills", async () => {
    mockListSkills.mockRejectedValue(new Error("Network error"));
    render(<SkillsTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText("orchestration")).toBeDefined();
      expect(screen.getByText("Network error")).toBeDefined();
      expect(screen.getByText("Retry")).toBeDefined();
    });
  });

  it("shows create prompt when no harness skills", async () => {
    mockListSkills.mockResolvedValue([]);
    render(<SkillsTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText(/click \+ to create/i)).toBeDefined();
    });
  });

  it("opens creation modal when + is clicked", async () => {
    mockListSkills.mockResolvedValue([]);
    render(<SkillsTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText(/click \+ to create/i)).toBeDefined();
    });
    const addBtn = screen.getByTitle("Create skill");
    fireEvent.click(addBtn);
    expect(screen.getByTestId("modal")).toBeDefined();
  });
});
