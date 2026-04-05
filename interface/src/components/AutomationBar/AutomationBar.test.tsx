import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, title, disabled, onClick, icon }: {
    children?: React.ReactNode; title?: string; disabled?: boolean;
    onClick?: () => void; icon?: React.ReactNode; variant?: string;
    size?: string; iconOnly?: boolean;
  }) => (
    <button title={title} disabled={disabled} onClick={onClick}>{icon}{children}</button>
  ),
  Text: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement> & { size?: string; variant?: string; as?: string }) => (
    <span {...props}>{children}</span>
  ),
  ModalConfirm: ({ isOpen, onClose, onConfirm, title, message, confirmLabel, cancelLabel }: {
    isOpen: boolean; onClose: () => void; onConfirm: () => void;
    title: string; message: string; confirmLabel?: string; cancelLabel?: string;
    danger?: boolean;
  }) =>
    isOpen ? (
      <div data-testid="modal-confirm">
        <h2>{title}</h2>
        <p>{message}</p>
        <button onClick={onClose}>{cancelLabel ?? "Cancel"}</button>
        <button onClick={onConfirm}>{confirmLabel ?? "Confirm"}</button>
      </div>
    ) : null,
}));

const mockGetLoopStatus = vi.fn();
const mockStartLoop = vi.fn();
const mockPauseLoop = vi.fn();
const mockStopLoop = vi.fn();

vi.mock("../../api/client", () => ({
  api: {
    getLoopStatus: (...args: unknown[]) => mockGetLoopStatus(...args),
    startLoop: (...args: unknown[]) => mockStartLoop(...args),
    pauseLoop: (...args: unknown[]) => mockPauseLoop(...args),
    stopLoop: (...args: unknown[]) => mockStopLoop(...args),
  },
  isInsufficientCreditsError: () => false,
  dispatchInsufficientCredits: vi.fn(),
}));

const subscribeMock = vi.fn((_type: string, _cb: (...args: unknown[]) => void) => vi.fn());

vi.mock("../../stores/event-store/index", () => {
  const store = {
    connected: true,
    subscribe: (...args: unknown[]) => subscribeMock(...args),
  };
  return {
    useEventStore: (selector: (s: typeof store) => unknown) => selector(store),
  };
});

const setActiveTabMock = vi.fn();
const mockSidekickState = { setActiveTab: setActiveTabMock };
vi.mock("../../stores/sidekick-store", () => ({
  useSidekickStore: Object.assign(
    vi.fn((selector?: (s: any) => any) => selector ? selector(mockSidekickState) : mockSidekickState),
    { getState: () => mockSidekickState, subscribe: vi.fn(() => vi.fn()) },
  ),
}));

vi.mock("../StatusBadge", () => ({
  StatusBadge: ({ status }: { status: string }) => <span data-testid="status">{status}</span>,
}));

vi.mock("./AutomationBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { AutomationBar } from "../AutomationBar";
import type { ProjectId } from "../../types";

function renderBar(projectId: ProjectId = "proj-1" as ProjectId) {
  return render(
    <MemoryRouter initialEntries={["/projects/proj-1/agents/agent-1"]}>
      <Routes>
        <Route
          path="/projects/:projectId/agents/:agentInstanceId"
          element={<AutomationBar projectId={projectId} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetLoopStatus.mockResolvedValue({ active_agent_instances: [], paused: false });
});

describe("AutomationBar", () => {
  it("renders Automation label and idle status", async () => {
    renderBar();
    expect(screen.getByText("Automation")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("idle");
    });
  });

  it("fetches loop status on mount", () => {
    renderBar();
    expect(mockGetLoopStatus).toHaveBeenCalledWith("proj-1");
  });

  it("shows active status when agents are running", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: false });
    renderBar();
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("active");
    });
  });

  it("shows paused status", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: true });
    renderBar();
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("paused");
    });
  });

  it("start button calls api.startLoop and switches to tasks tab", async () => {
    const user = userEvent.setup();
    mockStartLoop.mockResolvedValue({ active_agent_instances: ["a1"] });
    renderBar();

    await user.click(screen.getByTitle("Start"));
    expect(mockStartLoop).toHaveBeenCalledWith("proj-1", "agent-1");
    expect(setActiveTabMock).toHaveBeenCalledWith("tasks");
  });

  it("pause button calls api.pauseLoop", async () => {
    const user = userEvent.setup();
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: false });
    mockPauseLoop.mockResolvedValue(undefined);
    renderBar();

    await waitFor(() => {
      expect(screen.getByTitle("Pause")).toBeEnabled();
    });

    await user.click(screen.getByTitle("Pause"));
    expect(mockPauseLoop).toHaveBeenCalledWith("proj-1");
  });

  it("stop button shows confirmation dialog", async () => {
    const user = userEvent.setup();
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: false });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTitle("Stop")).toBeEnabled();
    });

    await user.click(screen.getByTitle("Stop"));
    expect(screen.getByText("Stop Execution")).toBeInTheDocument();
    expect(screen.getByText(/Stop autonomous execution/)).toBeInTheDocument();
  });

  it("confirming stop calls api.stopLoop", async () => {
    const user = userEvent.setup();
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: false });
    mockStopLoop.mockResolvedValue({ active_agent_instances: [] });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTitle("Stop")).toBeEnabled();
    });

    await user.click(screen.getByTitle("Stop"));
    const confirmBtn = screen.getByTestId("modal-confirm").querySelector("button:last-child")!;
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockStopLoop).toHaveBeenCalledWith("proj-1");
    });
  });

  it("disables play when running and not paused", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: false });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTitle("Start")).toBeDisabled();
    });
  });

  it("enables play (Resume) when paused", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: true });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTitle("Resume")).toBeEnabled();
    });
  });

  it("shows agent count when more than 1 agent", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1", "a2"], paused: false });
    renderBar();

    await waitFor(() => {
      expect(screen.getByText("2 agents")).toBeInTheDocument();
    });
  });

  it("does not show agent count for single agent", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: false });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("active");
    });
    expect(screen.queryByText(/agents/)).not.toBeInTheDocument();
  });
});
