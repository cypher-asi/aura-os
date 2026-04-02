import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { mockGetSnapshot } = vi.hoisted(() => ({
  mockGetSnapshot: vi.fn(),
}));

vi.mock("../../../api/client", () => ({
  api: {
    memory: {
      getSnapshot: (...args: any[]) => mockGetSnapshot(...args),
    },
  },
}));

vi.mock("../stores/agent-sidekick-store", () => ({
  useAgentSidekickStore: () => ({
    viewMemoryFact: vi.fn(),
    viewMemoryEvent: vi.fn(),
    viewMemoryProcedure: vi.fn(),
  }),
}));

vi.mock("./AgentInfoPanel.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { MemoryTab } from "./MemoryTab";

const baseAgent = { agent_id: "a1", name: "Test Agent" } as any;

const mockSnapshot = {
  facts: [
    { fact_id: "f1", key: "lang", value: "Rust", confidence: 0.9, source: "extracted" },
  ],
  events: [
    { event_id: "e1", event_type: "task_run", summary: "Did stuff", timestamp: "2024-01-15T10:00:00Z" },
  ],
  procedures: [
    { procedure_id: "p1", name: "deploy-flow", steps: ["build", "push"], success_rate: 0.8 },
  ],
};

describe("MemoryTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockGetSnapshot.mockReturnValue(new Promise(() => {}));
    render(<MemoryTab agent={baseAgent} />);
    expect(screen.getByText(/loading memory/i)).toBeDefined();
  });

  it("renders data on success", async () => {
    mockGetSnapshot.mockResolvedValue(mockSnapshot);
    render(<MemoryTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText("lang")).toBeDefined();
      expect(screen.getByText("task_run")).toBeDefined();
      expect(screen.getByText("deploy-flow")).toBeDefined();
    });
  });

  it("shows error state", async () => {
    mockGetSnapshot.mockRejectedValue(new Error("Connection failed"));
    render(<MemoryTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText(/could not connect/i)).toBeDefined();
    });
  });

  it("shows empty state when no data", async () => {
    mockGetSnapshot.mockResolvedValue({ facts: [], events: [], procedures: [] });
    render(<MemoryTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText(/no memories yet/i)).toBeDefined();
    });
  });

  it("filter buttons change visible items", async () => {
    mockGetSnapshot.mockResolvedValue(mockSnapshot);
    render(<MemoryTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText("lang")).toBeDefined();
    });

    const factsBtn = screen.getByText(/facts/i);
    fireEvent.click(factsBtn);
    expect(screen.getByText("lang")).toBeDefined();
    expect(screen.queryByText("deploy-flow")).toBeNull();
  });
});
