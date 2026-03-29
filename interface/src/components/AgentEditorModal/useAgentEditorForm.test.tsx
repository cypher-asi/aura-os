import { renderHook } from "@testing-library/react";
import type { Agent } from "../../types";
import { useAgentEditorForm } from "./useAgentEditorForm";

const mockUseAuraCapabilities = vi.fn();

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../../hooks/use-modal-initial-focus", () => ({
  useModalInitialFocus: () => ({
    inputRef: { current: null },
    initialFocusRef: undefined,
  }),
}));

vi.mock("../../api/client", () => ({
  api: {
    agents: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    agent_id: "agent-1" as Agent["agent_id"],
    user_id: "user-1",
    name: "Atlas",
    role: "Builder",
    personality: "Calm",
    system_prompt: "Help out",
    skills: [],
    icon: null,
    machine_type: "local",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("useAgentEditorForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });
  });

  it("defaults new desktop agents to local", () => {
    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    expect(result.current.machineType).toBe("local");
  });

  it("defaults new mobile agents to remote", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    const { result } = renderHook(() =>
      useAgentEditorForm(true, undefined, vi.fn(), vi.fn()),
    );

    expect(result.current.machineType).toBe("remote");
  });

  it("preserves an existing agent machine type while editing on mobile", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    const { result } = renderHook(() =>
      useAgentEditorForm(true, makeAgent({ machine_type: "local" }), vi.fn(), vi.fn()),
    );

    expect(result.current.machineType).toBe("local");
  });
});
