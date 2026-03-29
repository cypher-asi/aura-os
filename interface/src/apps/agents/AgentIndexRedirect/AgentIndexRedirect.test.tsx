import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { render, screen } from "@testing-library/react";

const mockUseAgents = vi.fn();
const mockUseSortedAgents = vi.fn();
const mockUseAuraCapabilities = vi.fn();

vi.mock("../../../components/EmptyState", () => ({
  EmptyState: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../stores", () => ({
  LAST_AGENT_ID_KEY: "aura:lastAgentId",
  useAgents: () => mockUseAgents(),
  useSortedAgents: () => mockUseSortedAgents(),
}));

import { AgentIndexRedirect } from "./AgentIndexRedirect";

describe("AgentIndexRedirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(globalThis, "localStorage", {
      value: {
        getItem: vi.fn(() => null),
        setItem: vi.fn(),
        removeItem: vi.fn(),
      },
      configurable: true,
    });
    mockUseAgents.mockReturnValue({
      agents: [
        { agent_id: "agent-1", name: "Builder Bot" },
      ],
      status: "ready",
    });
    mockUseSortedAgents.mockReturnValue([
      { agent_id: "agent-1", name: "Builder Bot" },
    ]);
  });

  it("keeps mobile on the library root when agents exist", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <Routes>
          <Route path="/agents" element={<AgentIndexRedirect />} />
          <Route path="/agents/:agentId" element={<div>Agent Route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Select an agent from your library.")).toBeInTheDocument();
    expect(screen.queryByText("Agent Route")).not.toBeInTheDocument();
  });

  it("keeps desktop redirect behavior", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <Routes>
          <Route path="/agents" element={<AgentIndexRedirect />} />
          <Route path="/agents/:agentId" element={<div>Agent Route</div>} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Agent Route")).toBeInTheDocument();
  });
});
