import { render, screen } from "../../../test/render";
import { Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, onClick }: { children?: React.ReactNode; onClick?: () => void }) => (
    <button type="button" onClick={onClick}>{children}</button>
  ),
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../../components/Avatar", () => ({
  Avatar: ({ name }: { name: string }) => <span data-testid="agent-avatar">{name}</span>,
}));

vi.mock("../../../shared/utils/format", () => ({
  formatChatTime: () => "now",
}));

const mockClosePreview = vi.fn();
const mockRefreshProjectAgents = vi.fn();
const mockGetLastAgent = vi.fn();
const mockSetLastAgent = vi.fn();
const mockSetLastProject = vi.fn();

vi.mock("../../../stores/sidekick-store", () => ({
  useSidekickStore: (selector: (state: { closePreview: () => void }) => unknown) => selector({ closePreview: mockClosePreview }),
}));

vi.mock("../../../stores/mobile-drawer-store", () => ({
  selectOverlayDrawerOpen: (state: { overlayDrawerOpen: boolean }) => state.overlayDrawerOpen,
  useMobileDrawerStore: (selector: (state: { overlayDrawerOpen: boolean }) => unknown) => selector({ overlayDrawerOpen: false }),
}));

vi.mock("../../../stores/projects-list-store", () => ({
  useProjectsListStore: (selector: (state: any) => unknown) => selector({
    agentsByProject: {
      "proj-1": [{
        agent_instance_id: "agent-inst-1",
        name: "CEO",
        role: "Operator",
        status: "ready",
        icon: "",
        updated_at: "2026-03-17T01:00:00.000Z",
      }],
    },
    loadingAgentsByProject: {},
    projects: [{ project_id: "proj-1", name: "QA Project" }],
    refreshProjectAgents: mockRefreshProjectAgents,
  }),
}));

vi.mock("../../../utils/storage", () => ({
  getLastAgent: (...args: unknown[]) => mockGetLastAgent(...args),
  setLastAgent: (...args: unknown[]) => mockSetLastAgent(...args),
  setLastProject: (...args: unknown[]) => mockSetLastProject(...args),
}));

vi.mock("./ProjectAgentsScreen.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { MobileProjectAgentsScreen } from "./ProjectAgentsScreen";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLastAgent.mockReturnValue(null);
});

describe("MobileProjectAgentsScreen", () => {
  it("opens the selected project agent chat from the mobile roster", async () => {
    const user = userEvent.setup();

    render(
      <Routes>
        <Route path="/projects/:projectId/agents" element={<MobileProjectAgentsScreen />} />
        <Route path="/projects/:projectId/agents/:agentInstanceId" element={<div>chat-destination</div>} />
      </Routes>,
      { routerProps: { initialEntries: ["/projects/proj-1/agents"] } },
    );

    expect(screen.getByText("1 attached")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open chat with CEO" }));

    expect(mockClosePreview).toHaveBeenCalled();
    expect(mockSetLastProject).toHaveBeenCalledWith("proj-1");
    expect(mockSetLastAgent).toHaveBeenCalledWith("proj-1", "agent-inst-1");
    expect(screen.getByText("chat-destination")).toBeInTheDocument();
  });
});
