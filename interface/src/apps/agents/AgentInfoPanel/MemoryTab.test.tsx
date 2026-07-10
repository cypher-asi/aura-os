import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";

const {
  mockGetSnapshot,
  mockGetContinuityConfig,
  mockUpdateContinuityConfig,
  mockGetLatestRetrievalTrace,
  mockUpdateFact,
  MockApiClientError,
  mockUseIsStreaming,
} = vi.hoisted(() => {
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
  return {
    mockGetSnapshot: vi.fn(),
    mockGetContinuityConfig: vi.fn(),
    mockUpdateContinuityConfig: vi.fn(),
    mockGetLatestRetrievalTrace: vi.fn(),
    mockUpdateFact: vi.fn(),
    MockApiClientError: _MockApiClientError,
    mockUseIsStreaming: vi.fn(() => false),
  };
});

vi.mock("../../../api/client", () => ({
  api: {
    memory: {
      getSnapshot: (...args: any[]) => mockGetSnapshot(...args),
      getContinuityConfig: (...args: any[]) => mockGetContinuityConfig(...args),
      updateContinuityConfig: (...args: any[]) => mockUpdateContinuityConfig(...args),
      getLatestRetrievalTrace: (...args: any[]) => mockGetLatestRetrievalTrace(...args),
      updateFact: (...args: any[]) => mockUpdateFact(...args),
    },
  },
  ApiClientError: MockApiClientError,
}));

vi.mock("../../../hooks/stream/hooks", () => ({
  useIsStreaming: (...args: any[]) => mockUseIsStreaming(...args),
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
    { procedure_id: "p1", name: "deploy-flow", steps: ["build", "push"], success_rate: 0.8, skill_name: "deploy", skill_relevance: 0.95 },
  ],
};

describe("MemoryTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const config = {
      use_memory: true,
      generate_memory: true,
      write_policy: "automatic",
      retrieval_mode: "query_aware",
      allow_user_scope: false,
      allow_workspace_scope: false,
    };
    mockGetContinuityConfig.mockResolvedValue(config);
    mockUpdateContinuityConfig.mockImplementation(async (_agentId, next) => next);
    mockGetLatestRetrievalTrace.mockResolvedValue(null);
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
    expect(mockGetSnapshot).toHaveBeenCalledWith("a1");
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

  it("shows skill name in procedure detail", async () => {
    mockGetSnapshot.mockResolvedValue(mockSnapshot);
    render(<MemoryTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText("deploy-flow")).toBeDefined();
      expect(screen.getByText(/2 steps/)).toBeDefined();
    });
  });

  it("filter buttons change visible items", async () => {
    mockGetSnapshot.mockResolvedValue(mockSnapshot);
    render(<MemoryTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText("lang")).toBeDefined();
    });

    // The filter chip and the section header share the name "Facts (1)";
    // the chip renders first in DOM order.
    fireEvent.click(screen.getAllByRole("button", { name: "Facts (1)" })[0]);
    expect(screen.getByText("lang")).toBeDefined();
    expect(screen.queryByText("deploy-flow")).toBeNull();
  });

  it("soft-refreshes after streaming stops", async () => {
    mockUseIsStreaming.mockReturnValue(true);
    mockGetSnapshot.mockResolvedValue(mockSnapshot);
    const { rerender } = render(<MemoryTab agent={baseAgent} />);
    await waitFor(() => {
      expect(screen.getByText("lang")).toBeDefined();
    });

    const initialCallCount = mockGetSnapshot.mock.calls.length;

    const updatedSnapshot = {
      ...mockSnapshot,
      facts: [
        ...mockSnapshot.facts,
        { fact_id: "f2", key: "new_fact", value: "hello", confidence: 0.9, source: "extracted" },
      ],
    };
    mockGetSnapshot.mockResolvedValue(updatedSnapshot);
    mockUseIsStreaming.mockReturnValue(false);
    rerender(<MemoryTab agent={baseAgent} />);

    await waitFor(() => {
      expect(mockGetSnapshot.mock.calls.length).toBeGreaterThan(initialCallCount);
    }, { timeout: 3000 });
    expect(mockGetSnapshot).toHaveBeenLastCalledWith("a1");

    await waitFor(() => {
      expect(screen.getByText("new_fact")).toBeDefined();
    });
  });

  it("shows continuity controls and privacy-safe retrieval evidence", async () => {
    mockGetSnapshot.mockResolvedValue(mockSnapshot);
    mockGetContinuityConfig.mockResolvedValue({
      use_memory: true,
      generate_memory: true,
      write_policy: "approval",
      retrieval_mode: "query_aware",
      allow_user_scope: false,
      allow_workspace_scope: false,
    });
    mockGetLatestRetrievalTrace.mockResolvedValue({
      candidate_count: 14,
      selected_count: 3,
      estimated_tokens: 96,
      duration_ms: 2,
      query_aware: true,
      selections: [],
    });

    render(<MemoryTab agent={baseAgent} />);

    await waitFor(() => expect(screen.getByText("Agent Continuity")).toBeDefined());
    expect(screen.getByDisplayValue("Require approval")).toBeDefined();
    expect(screen.getByText("3").closest("span")?.textContent).toContain("recalled");
    expect(screen.getByTestId("continuity-trace").textContent).toContain("Request-aware");
  });

  it("persists continuity controls per agent", async () => {
    mockGetSnapshot.mockResolvedValue(mockSnapshot);
    render(<MemoryTab agent={baseAgent} />);

    const useMemory = await screen.findByRole("checkbox", { name: /use memory/i });
    fireEvent.click(useMemory);

    await waitFor(() => {
      expect(mockUpdateContinuityConfig).toHaveBeenCalledWith(
        "a1",
        expect.objectContaining({ use_memory: false }),
      );
    });
  });

  it("approves a pending memory before it can be recalled", async () => {
    const pending = {
      ...mockSnapshot.facts[0],
      continuity: {
        scope: "agent",
        status: "pending",
        sensitivity: "normal",
        pinned: false,
        provenance: { session_id: "session-7", excerpt: "I prefer Rust" },
      },
    };
    mockGetSnapshot.mockResolvedValue({ ...mockSnapshot, facts: [pending] });
    mockUpdateFact.mockResolvedValue({
      ...pending,
      continuity: { ...pending.continuity, status: "active" },
    });
    render(<MemoryTab agent={baseAgent} />);

    const approve = await screen.findByRole("button", { name: "Approve memory" });
    fireEvent.click(approve);

    await waitFor(() => {
      expect(mockUpdateFact).toHaveBeenCalledWith(
        "a1",
        "f1",
        expect.objectContaining({
          continuity: expect.objectContaining({ status: "active" }),
        }),
      );
    });
  });
});
