import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const { mockGetSnapshot, MockApiClientError } = vi.hoisted(() => {
  class _MockApiClientError extends Error {
    status: number;
    body: { error: string; code: string; details: null };
    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiClientError";
      this.status = status;
      this.body = { error: message, code: "unknown", details: null };
    }
  }
  return { mockGetSnapshot: vi.fn(), MockApiClientError: _MockApiClientError };
});

vi.mock("../../../api/client", () => ({
  api: {
    memory: {
      getSnapshot: (...args: any[]) => mockGetSnapshot(...args),
    },
  },
  ApiClientError: MockApiClientError,
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

  it("shows connection error for 502", async () => {
    mockGetSnapshot.mockRejectedValue(new MockApiClientError(502, "Bad Gateway"));
    render(<MemoryTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText(/could not connect to harness/i)).toBeDefined();
    });
  });

  it("shows generic error for unknown failures", async () => {
    mockGetSnapshot.mockRejectedValue(new Error("Something broke"));
    render(<MemoryTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText(/failed to load memory/i)).toBeDefined();
    });
  });

  it("shows retry button on error", async () => {
    mockGetSnapshot.mockRejectedValue(new MockApiClientError(502, "Bad Gateway"));
    render(<MemoryTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeDefined();
    });
  });

  it("treats 404 as empty (no memories yet)", async () => {
    mockGetSnapshot.mockRejectedValue(new MockApiClientError(404, "Not Found"));
    render(<MemoryTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText(/no memories yet/i)).toBeDefined();
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
