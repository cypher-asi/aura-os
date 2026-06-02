import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useOnboardingStore } from "../onboarding-store";

const mockUseAuraCapabilities = vi.fn();

vi.mock("../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockUseAuraCapabilities(),
}));

vi.mock("../../../apps/projects/useProjectsList", () => ({
  useProjectsList: () => ({ openNewProjectModal: vi.fn() }),
}));

vi.mock("../../../stores/ui-modal-store", () => ({
  useUIModalStore: (selector: (state: { openOrgBilling: () => void }) => unknown) => selector({ openOrgBilling: vi.fn() }),
}));

vi.mock("../../../apps/agents/stores/agent-store", () => ({
  useAgentStore: (selector: (state: { openCreateAgentModal: () => void }) => unknown) => selector({ openCreateAgentModal: vi.fn() }),
}));

vi.mock("../../../lib/analytics", () => ({
  track: vi.fn(),
}));

vi.mock("./OnboardingChecklist.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { OnboardingChecklist } from "./OnboardingChecklist";

function seedVisibleChecklist() {
  useOnboardingStore.setState({
    userId: "user-1",
    welcomeCompleted: true,
    welcomeSkipped: false,
    checklistDismissed: false,
    checklistTasks: {
      send_message: true,
      create_project: false,
      create_agent: false,
      try_3d: false,
      view_billing: false,
    },
    checklistCollapsed: false,
  });
}

function renderChecklist() {
  return render(
    <MemoryRouter>
      <OnboardingChecklist />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  seedVisibleChecklist();
});

describe("OnboardingChecklist", () => {
  it("renders on desktop layouts", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: false });

    renderChecklist();

    expect(screen.getByText("Getting Started")).toBeInTheDocument();
  });

  it("does not cover mobile project screens", () => {
    mockUseAuraCapabilities.mockReturnValue({ isMobileLayout: true });

    renderChecklist();

    expect(screen.queryByText("Getting Started")).not.toBeInTheDocument();
  });
});
