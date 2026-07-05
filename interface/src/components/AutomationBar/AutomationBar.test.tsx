import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
const mockStartLoopEngineering = vi.fn();
const mockPauseLoop = vi.fn();
const mockStopLoop = vi.fn();
const mockResumeLoop = vi.fn();
const mockListAgentInstances = vi.fn();
const mockListLoops = vi.fn();
let mockLinkedWorkspace = true;
let mockTerminalTarget = {
  remoteAgentId: undefined as string | undefined,
  remoteWorkspacePath: undefined as string | undefined,
  workspacePath: "/Users/demo/project" as string | undefined,
  status: "ready" as "loading" | "ready" | "error",
};

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({
    features: { linkedWorkspace: mockLinkedWorkspace },
  }),
}));

vi.mock("../../hooks/use-terminal-target", () => ({
  useTerminalTarget: () => mockTerminalTarget,
}));

vi.mock("../../api/client", () => {
  // Defined inside the factory so the hoisted `vi.mock` does not
  // reference a top-level identifier before initialisation. Minimal
  // stand-in for the real `ApiClientError` — `describeStartLoopError`
  // in `useAutomationStatus` checks `err instanceof ApiClientError`
  // and then reads `body.code` / `body.error` / `body.data.automaton_id`
  // off it to decide which modal copy to render, so the shape here
  // mirrors `interface/src/shared/api/core.ts` byte-for-byte.
  class MockApiClientError extends Error {
    status: number;
    body: {
      error: string;
      code: string;
      details: string | null;
      data?: unknown;
    };
    constructor(
      status: number,
      body: {
        error: string;
        code: string;
        details: string | null;
        data?: unknown;
      },
    ) {
      super(body.error);
      this.name = "ApiClientError";
      this.status = status;
      this.body = body;
    }
  }
  return {
    api: {
      getLoopStatus: (...args: unknown[]) => mockGetLoopStatus(...args),
      startLoop: (...args: unknown[]) => mockStartLoop(...args),
      startLoopEngineering: (...args: unknown[]) => mockStartLoopEngineering(...args),
      pauseLoop: (...args: unknown[]) => mockPauseLoop(...args),
      stopLoop: (...args: unknown[]) => mockStopLoop(...args),
      resumeLoop: (...args: unknown[]) => mockResumeLoop(...args),
      listAgentInstances: (...args: unknown[]) => mockListAgentInstances(...args),
      listLoops: (...args: unknown[]) => mockListLoops(...args),
    },
    ApiClientError: MockApiClientError,
    isInsufficientCreditsError: () => false,
    dispatchInsufficientCredits: vi.fn(),
  };
});

// Re-import the mocked class for use inside the test bodies. Vitest
// resolves this to the same `MockApiClientError` constructor defined
// in the factory above, so `err instanceof ApiClientError` checks
// inside `describeStartLoopError` evaluate true on instances created
// with this binding.
import { ApiClientError as MockApiClientError } from "../../api/client";

type SubscribeCallback = (event: Record<string, unknown>) => void;

// Per-event-type registry of subscribed callbacks so individual tests
// can drive the AutomationBar through real WS lifecycle events
// (loop_started, loop_finished, etc.) rather than relying solely on
// the HTTP polling path.
const subscribeMap = new Map<string, Set<SubscribeCallback>>();

const subscribeMock = vi.fn((type: string, cb: SubscribeCallback) => {
  if (!subscribeMap.has(type)) subscribeMap.set(type, new Set());
  subscribeMap.get(type)!.add(cb);
  return () => subscribeMap.get(type)?.delete(cb);
});

function fireEvent(type: string, event: Record<string, unknown>): void {
  subscribeMap.get(type)?.forEach((cb) => cb(event));
}

vi.mock("../../stores/event-store/index", () => {
  const store = {
    connected: true,
    subscribe: (...args: unknown[]) => subscribeMock(...(args as Parameters<typeof subscribeMock>)),
  };
  return {
    useEventStore: (selector: (s: typeof store) => unknown) => selector(store),
  };
});

vi.mock("../StatusBadge", () => ({
  StatusBadge: ({ status }: { status: string }) => <span data-testid="status">{status}</span>,
}));

vi.mock("./AutomationBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

// The picker pulls in InputBarShell CSS through `inputBarShellStyles`
// — short-circuit it here so the test harness doesn't try to parse a
// real CSS module. Mock factory is hoisted, so we can't reference
// top-level imports; pull `useState` in via a relative require so
// the mocked picker can manage its own open/closed state.
vi.mock("../InputBarShell", async () => {
  const React = await import("react");
  return {
    ModelPicker: ({
      selectedLabel,
      renderMenu,
      isInteractive,
      triggerProps,
    }: {
      selectedLabel: string;
      renderMenu: (close: () => void) => React.ReactNode;
      isInteractive?: boolean;
      triggerProps?: Record<string, unknown>;
    }) => {
      const [open, setOpen] = React.useState(false);
      return (
        <div data-testid="automation-model-picker">
          <button
            type="button"
            data-testid="automation-model-trigger"
            disabled={isInteractive === false}
            aria-expanded={open}
            {...triggerProps}
            onClick={() => setOpen((v: boolean) => !v)}
          >
            {selectedLabel}
          </button>
          {open ? renderMenu(() => setOpen(false)) : null}
        </div>
      );
    },
    inputBarShellStyles: new Proxy({}, { get: (_t, prop) => String(prop) }),
  };
});

import { AutomationBar } from "../AutomationBar";
import { useAutomationLoopStore } from "../../stores/automation-loop-store";
import type { ProjectId } from "../../shared/types";

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
  subscribeMap.clear();
  useAutomationLoopStore.getState().reset();
  mockLinkedWorkspace = true;
  mockTerminalTarget = {
    remoteAgentId: undefined,
    remoteWorkspacePath: undefined,
    workspacePath: "/Users/demo/project",
    status: "ready",
  };
  // The automation model selector falls back to localStorage when the
  // in-memory map is empty, so tests must clear both halves of the
  // persistence chain to start from a clean slate. Without this, a
  // model picked in one test leaks into the next via the per-project
  // localStorage key.
  try {
    localStorage.clear();
  } catch {
    // jsdom always supports localStorage, but stay defensive.
  }
  mockGetLoopStatus.mockResolvedValue({ active_agent_instances: [], paused: false });
  mockStartLoopEngineering.mockResolvedValue({
    active_agent_instances: ["loop-agent-1"],
    agent_instance_id: "loop-agent-1",
  });
  // The bar resolves the project's `Loop`-role instance on mount so
  // pause/resume/stop scope to it; default to a mature project that
  // already has one.
  mockListAgentInstances.mockResolvedValue([
    { agent_instance_id: "agent-1", instance_role: "chat" },
    { agent_instance_id: "loop-agent-1", instance_role: "loop" },
  ]);
  // Project-scoped rehydrate of the unified spinner store fires on
  // every Start / Stop click as a safety net against rapid Stop+Start
  // racing the `loop_opened` / `loop_ended` WS events. The hydrate
  // path calls `api.listLoops` under the hood, so every test needs a
  // benign default to keep the safety-net dormant.
  mockListLoops.mockResolvedValue({ loops: [] });
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

  it("shows the active Loop Engineering contract from loop status", async () => {
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: false,
      loop_engineering: {
        goal: "Fix checkout flakes and prove the regression is gone",
        successCriteria: ["Checkout passes", "Regression test covers it"],
        verifierCommands: [
          {
            label: "Checkout test",
            command: "npm test -- checkout",
            expectedOutcome: "passes",
          },
        ],
        maxIterations: 5,
        approvalPolicy: "apply_within_workspace",
        learning: {
          captureTrace: true,
          proposeEvals: true,
          proposeSkills: true,
          summarizeRegressions: true,
        },
      },
    });

    renderBar();

    await waitFor(() => {
      expect(screen.getByText("Loop Engineering active")).toBeInTheDocument();
    });
    expect(
      screen.getByText("Fix checkout flakes and prove the regression is gone"),
    ).toBeInTheDocument();
    expect(screen.getByText("Loop Engineering")).toBeInTheDocument();
    expect(screen.getByText(/5 iterations \/ 2 criteria \/ 1 verifier/))
      .toBeInTheDocument();
  });

  it("shows paused status", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: true });
    renderBar();
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("paused");
    });
  });

  it("start button calls api.startLoop without an agent id so the backend resolves the Loop instance", async () => {
    const user = userEvent.setup();
    mockStartLoop.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      agent_instance_id: "loop-agent-1",
    });
    // Seed an explicit AutomationBar model so we exercise the
    // thread-through path; without this the store would emit `null`
    // and the assertion below would fight a fallback path that
    // belongs in its own test.
    useAutomationLoopStore
      .getState()
      .setLoopModel("proj-1" as ProjectId, "aura-claude-opus-4-7");
    renderBar();
    // Wait for the on-mount listAgentInstances() to settle so the
    // hook has hydrated `boundLoopId` before we click.
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await user.click(screen.getByTitle("Start"));
    expect(mockStartLoop).toHaveBeenCalledWith(
      "proj-1",
      undefined,
      "aura-claude-opus-4-7",
    );
  });

  it("disables build automation for a local workspace when the desktop bridge is unavailable", async () => {
    mockLinkedWorkspace = false;
    mockTerminalTarget = {
      remoteAgentId: undefined,
      remoteWorkspacePath: undefined,
      workspacePath: "/Users/demo/project",
      status: "ready",
    };

    renderBar();

    const blockedButtons = screen.getAllByTitle(
      "Build tools for local workspaces are available in Aura Desktop",
    );
    expect(blockedButtons).toHaveLength(2);
    blockedButtons.forEach((button) => expect(button).toBeDisabled());
    expect(screen.getByRole("button", { name: /Loop/i })).toBeDisabled();
  });

  it("start uses the model shown in the AutomationBar picker even before an explicit per-project pick", async () => {
    const user = userEvent.setup();
    mockStartLoop.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      agent_instance_id: "loop-agent-1",
    });
    localStorage.setItem("aura-selected-model:aura_harness", "aura-claude-opus-4-7");
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));
    expect(screen.getByTestId("automation-model-trigger")).toHaveTextContent("Opus 4.7");

    await user.click(screen.getByTitle("Start"));
    expect(mockStartLoop).toHaveBeenCalledWith(
      "proj-1",
      undefined,
      "aura-claude-opus-4-7",
    );
  });

  it("model picker writes the selected model into the automation-loop store and the next Start uses it", async () => {
    const user = userEvent.setup();
    mockStartLoop.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      agent_instance_id: "loop-agent-1",
    });
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await user.click(screen.getByTestId("automation-model-trigger"));
    // Disambiguate from the trigger label (which echoes the active
    // selection) by querying inside the dropdown via the data-attr we
    // stamp on each menu item — both elements show "Opus 4.7" text.
    const opusOption = await waitFor(() => {
      const el = document.querySelector(
        '[data-agent-model-id="aura-claude-opus-4-7"]',
      );
      if (!el) throw new Error("Opus 4.7 menu item not yet rendered");
      return el as HTMLElement;
    });
    await user.click(opusOption);

    expect(
      useAutomationLoopStore.getState().getLoopModel("proj-1" as ProjectId),
    ).toBe("aura-claude-opus-4-7");

    await user.click(screen.getByTitle("Start"));
    expect(mockStartLoop).toHaveBeenCalledWith(
      "proj-1",
      undefined,
      "aura-claude-opus-4-7",
    );
  });

  it("starts Loop Engineering with a goal, criteria, verifier, model, and learning policy", async () => {
    const user = userEvent.setup();
    useAutomationLoopStore
      .getState()
      .setLoopModel("proj-1" as ProjectId, "aura-claude-opus-4-7");
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await user.click(screen.getByTitle("Loop Engineering"));
    await user.type(
      screen.getByLabelText("Goal"),
      "Fix the action-item date drift",
    );
    await user.click(screen.getByTitle("Add verifier"));
    await user.type(screen.getByLabelText("Verifier 1 label"), "Tests");
    await user.type(
      screen.getByLabelText("Verifier 1 command"),
      "npm test -- --run",
    );
    await user.type(
      screen.getByLabelText("Verifier 1 expected outcome"),
      "All tests pass",
    );
    await user.click(screen.getByRole("button", { name: "Start Loop Engineering" }));

    await waitFor(() => expect(mockStartLoopEngineering).toHaveBeenCalled());
    expect(mockStartLoopEngineering).toHaveBeenCalledWith(
      "proj-1",
      {
        loopEngineering: expect.objectContaining({
          goal: "Fix the action-item date drift",
          successCriteria: [
            "Requested behavior works end to end",
            "Existing tests, build, or project-native smoke checks pass",
            "Final report includes evidence, changes, risks, and learnings",
          ],
          verifierCommands: [
            {
              label: "Tests",
              command: "npm test -- --run",
              expectedOutcome: "All tests pass",
            },
          ],
          maxIterations: 4,
          approvalPolicy: "apply_within_workspace",
          learning: {
            captureTrace: true,
            proposeEvals: true,
            proposeSkills: true,
            summarizeRegressions: true,
          },
        }),
      },
      undefined,
      "aura-claude-opus-4-7",
    );
  });

  it("disables the model picker once the loop is running so users can't pretend to swap mid-run", async () => {
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: false,
    });
    renderBar();
    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("active");
    });
    expect(screen.getByTestId("automation-model-trigger")).toBeDisabled();
  });

  it("captures the resolved Loop agent id from startLoop and routes pause/stop through it", async () => {
    const user = userEvent.setup();
    // Project starts with no Loop instance — the backend creates one
    // on first start and returns its id, which the bar must reuse for
    // every subsequent control call.
    mockListAgentInstances.mockResolvedValue([
      { agent_instance_id: "agent-1", instance_role: "chat" },
    ]);
    mockStartLoop.mockResolvedValue({
      active_agent_instances: ["loop-agent-fresh"],
      agent_instance_id: "loop-agent-fresh",
    });
    mockPauseLoop.mockResolvedValue({
      active_agent_instances: ["loop-agent-fresh"],
      paused: true,
    });
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalled());

    await user.click(screen.getByTitle("Start"));
    await waitFor(() =>
      expect(useAutomationLoopStore.getState().getLoopAgent("proj-1" as ProjectId)).toBe(
        "loop-agent-fresh",
      ),
    );

    await user.click(screen.getByTitle("Pause"));
    expect(mockPauseLoop).toHaveBeenCalledWith("proj-1", "loop-agent-fresh");
  });

  it("pause button targets the bound Loop instance rather than the URL chat agent", async () => {
    const user = userEvent.setup();
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: false,
    });
    mockPauseLoop.mockResolvedValue(undefined);
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await waitFor(() => {
      expect(screen.getByTitle("Pause")).toBeEnabled();
    });

    await user.click(screen.getByTitle("Pause"));
    expect(mockPauseLoop).toHaveBeenCalledWith("proj-1", "loop-agent-1");
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

  it("confirming stop calls api.stopLoop against the bound Loop instance", async () => {
    const user = userEvent.setup();
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: false,
    });
    mockStopLoop.mockResolvedValue({ active_agent_instances: [] });
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await waitFor(() => {
      expect(screen.getByTitle("Stop")).toBeEnabled();
    });

    await user.click(screen.getByTitle("Stop"));
    const confirmBtn = screen.getByTestId("modal-confirm").querySelector("button:last-child")!;
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockStopLoop).toHaveBeenCalledWith("proj-1", "loop-agent-1");
    });
  });

  it("rehydrates the unified loop-activity store with a project filter on Stop", async () => {
    // Regression: rapid Stop+Start cycles could leave the
    // `LoopProgress` ring around the play button spinning forever,
    // because the client was waiting on a `loop_ended` WS event that
    // the server had already raced past. The safety net is a
    // project-scoped `loop-activity-store.hydrate({ project_id })`
    // call after every successful Stop — it collapses the race
    // window to a single HTTP round-trip and forces the spinner
    // store to reconcile with authoritative server state.
    const user = userEvent.setup();
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: false,
    });
    mockStopLoop.mockResolvedValue({ active_agent_instances: [] });
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));
    await waitFor(() => {
      expect(screen.getByTitle("Stop")).toBeEnabled();
    });

    await user.click(screen.getByTitle("Stop"));
    const confirmBtn = screen.getByTestId("modal-confirm").querySelector("button:last-child")!;
    await user.click(confirmBtn);

    await waitFor(() => expect(mockStopLoop).toHaveBeenCalled());
    // Project-scoped filter is required — an unfiltered hydrate
    // would wipe live loops in other projects via
    // `replaceSnapshot`. The filter shape mirrors
    // `LoopsFilter` from `shared/api/loop.ts`.
    await waitFor(() => {
      expect(mockListLoops).toHaveBeenCalledWith({ project_id: "proj-1" });
    });
  });

  it("rehydrates loop-activity on Start so the spinner snaps to server truth", async () => {
    // Symmetric Start-side safety net. Without it, a Start that
    // races a slow `loop_opened` WS event would leave the ring
    // empty until the per-client stall watchdog fires.
    const user = userEvent.setup();
    mockStartLoop.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: false,
      active_tasks: [],
    });
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));
    await waitFor(() => {
      expect(screen.getByTitle("Start")).toBeEnabled();
    });

    await user.click(screen.getByTitle("Start"));
    await waitFor(() => expect(mockStartLoop).toHaveBeenCalled());
    await waitFor(() => {
      expect(mockListLoops).toHaveBeenCalledWith({ project_id: "proj-1" });
    });
  });

  it("clears UI state and surfaces an error when stop fails", async () => {
    const user = userEvent.setup();
    mockGetLoopStatus.mockResolvedValueOnce({ active_agent_instances: ["a1"], paused: false });
    // Reconciliation fetch after the failed stop returns no active agents so
    // we can assert the UI recovers to the Run state.
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: [], paused: false });
    mockStopLoop.mockRejectedValue(new Error("harness unreachable"));
    renderBar();

    await waitFor(() => {
      expect(screen.getByTitle("Stop")).toBeEnabled();
    });

    await user.click(screen.getByTitle("Stop"));
    const confirmBtn = screen.getByTestId("modal-confirm").querySelector("button:last-child")!;
    await user.click(confirmBtn);

    // Error surfaces through a ModalConfirm with the "Stop failed" title.
    await waitFor(() => {
      expect(screen.getByText("Stop failed")).toBeInTheDocument();
    });
    expect(screen.getByText("harness unreachable")).toBeInTheDocument();

    // Play button is re-enabled (UI was optimistically cleared + reconciled).
    await waitFor(() => {
      expect(screen.getByTitle("Start")).toBeEnabled();
    });
  });

  it("disables play when running and not paused", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: false });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTitle("Start")).toBeDisabled();
    });
  });

  it("keeps the Play icon visible and overlays a progress ring while the loop is active", async () => {
    // Regression: an earlier version swapped the Play icon for a
    // Loader2 spinner during `starting`/`preparing`, then dropped
    // the spinner once `active` arrived — leaving a bare Play icon
    // on a still-running loop and making the bar look idle. The
    // current contract is: Play icon stays put, an SVG ring overlay
    // spins around it whenever the loop is doing work.
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: false,
    });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("active");
    });

    const startBtn = screen.getByTitle("Start");
    // Play glyph still present (button affordance remains
    // recognisable, just visually decorated by the ring). The
    // single-SVG `PlayLoopGlyph` draws the Play polygon itself, so
    // we look for the polygon path rather than a lucide-play class.
    expect(startBtn.querySelector("svg polygon")).toBeInTheDocument();
    // Ring overlay is rendered.
    expect(screen.getByTestId("play-loop-ring")).toBeInTheDocument();
  });

  it("does not render the progress ring while the loop is idle", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: [], paused: false });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("idle");
    });

    expect(screen.queryByTestId("play-loop-ring")).not.toBeInTheDocument();
  });

  it("hides the progress ring once the loop is paused so Resume reads as a real affordance", async () => {
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: true,
    });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTitle("Resume")).toBeEnabled();
    });

    expect(screen.queryByTestId("play-loop-ring")).not.toBeInTheDocument();
  });

  it("enables play (Resume) when paused", async () => {
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: ["a1"], paused: true });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTitle("Resume")).toBeEnabled();
    });
  });

  it("resume routes through the bound Loop instance, not the URL chat agent", async () => {
    const user = userEvent.setup();
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: true,
    });
    mockResumeLoop.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: false,
    });
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await waitFor(() => {
      expect(screen.getByTitle("Resume")).toBeEnabled();
    });

    await user.click(screen.getByTitle("Resume"));
    expect(mockResumeLoop).toHaveBeenCalledWith("proj-1", "loop-agent-1");
    // The chat surface's `agent-1` must never be passed to a loop control call.
    expect(mockResumeLoop).not.toHaveBeenCalledWith("proj-1", "agent-1");
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

  // Regression: clicking Play used to silently `console.error` when
  // `POST /loop/start` returned 409 ("a dev loop is already running")
  // — the button stayed clickable, no toast, no modal, so the user
  // could not tell anything had happened. These two tests pin the new
  // contract: every failed Start surfaces through a ModalConfirm, and
  // the structured `automation_already_running` 409 specifically
  // renders a "Reset and retry" affordance instead of a Dismiss
  // button so the user can recover from the harness wedge in one click.
  it("surfaces a Dismiss modal when /loop/start fails with a generic error", async () => {
    const user = userEvent.setup();
    mockStartLoop.mockRejectedValueOnce(new Error("network down"));
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await user.click(screen.getByTitle("Start"));

    await waitFor(() => {
      expect(screen.getByText("Start failed")).toBeInTheDocument();
    });
    expect(screen.getByText("network down")).toBeInTheDocument();
    // Generic-error modal carries the Dismiss button, NOT the Reset
    // affordance reserved for the structured wedge case.
    expect(screen.queryByText("Reset and retry")).not.toBeInTheDocument();
  });

  it("renders Reset and retry for automation_already_running 409 and calls stopLoop + startLoop on confirm", async () => {
    const user = userEvent.setup();
    // First Start call hits the harness wedge; second Start (after
    // Reset) succeeds so we can verify the chained retry.
    mockStartLoop
      .mockRejectedValueOnce(
        new MockApiClientError(409, {
          error:
            "A dev loop is already running on the harness (automaton auto-wedge).",
          code: "automation_already_running",
          details: null,
          data: { code: "automation_already_running", automaton_id: "auto-wedge" },
        }),
      )
      .mockResolvedValueOnce({
        active_agent_instances: ["loop-agent-1"],
        agent_instance_id: "loop-agent-1",
      });
    mockStopLoop.mockResolvedValueOnce({
      active_agent_instances: [],
      paused: false,
    });
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    await user.click(screen.getByTitle("Start"));

    // Wedge modal copy + Reset affordance present.
    await waitFor(() => {
      expect(
        screen.getByText("Automation is wedged on the harness"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("Reset and retry")).toBeInTheDocument();

    // The Reset button is the "confirm" slot of the ModalConfirm mock —
    // last button inside the modal node.
    const resetBtn = screen.getByTestId("modal-confirm").querySelector(
      "button:last-child",
    )!;
    await user.click(resetBtn);

    await waitFor(() => expect(mockStopLoop).toHaveBeenCalled());
    // Initial click + the retry triggered by Reset.
    await waitFor(() => expect(mockStartLoop).toHaveBeenCalledTimes(2));
  });

  // Regression: clicking Start on the AutomationBar used to silently
  // flip the StatusBadge back to "idle" the moment any forwarder in
  // the same project emitted a `loop_finished` — including the short-
  // lived ephemeral task-runner automatons that the dev-loop scheduler
  // spawns per task via `run_single_task`. The bar should only flip
  // back to idle when the BOUND Loop instance itself ends; events
  // from sibling ephemeral runners must be ignored.
  it("ignores loop_finished from ephemeral task-runner agents while the bound Loop stays active", async () => {
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: false,
    });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("active");
    });
    await waitFor(() =>
      expect(useAutomationLoopStore.getState().getLoopAgent("proj-1" as ProjectId)).toBe(
        "loop-agent-1",
      ),
    );

    // An ephemeral task-runner finishes and its forwarder teardown
    // emits `loop_finished` for the runner's own ephemeral id. The
    // bar must NOT treat that as the bound Loop ending.
    act(() => {
      fireEvent("loop_finished", {
        project_id: "proj-1",
        agent_id: "ephemeral-task-runner-1",
        content: {},
      });
    });

    expect(screen.getByTestId("status")).toHaveTextContent("active");
  });

  it("flips to idle when loop_finished arrives for the bound Loop instance", async () => {
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: false,
    });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("active");
    });
    await waitFor(() =>
      expect(useAutomationLoopStore.getState().getLoopAgent("proj-1" as ProjectId)).toBe(
        "loop-agent-1",
      ),
    );

    act(() => {
      fireEvent("loop_finished", {
        project_id: "proj-1",
        agent_id: "loop-agent-1",
        content: {},
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("idle");
    });
  });

  it("ignores loop_stopped from ephemeral task-runner agents while the bound Loop stays active", async () => {
    mockGetLoopStatus.mockResolvedValue({
      active_agent_instances: ["loop-agent-1"],
      paused: false,
    });
    renderBar();

    await waitFor(() => {
      expect(screen.getByTestId("status")).toHaveTextContent("active");
    });
    await waitFor(() =>
      expect(useAutomationLoopStore.getState().getLoopAgent("proj-1" as ProjectId)).toBe(
        "loop-agent-1",
      ),
    );

    act(() => {
      fireEvent("loop_stopped", {
        project_id: "proj-1",
        agent_id: "ephemeral-task-runner-1",
        content: {},
      });
    });

    expect(screen.getByTestId("status")).toHaveTextContent("active");
  });

  // On a brand-new project (no Loop-role row yet, so
  // `listAgentInstances` returns no `loop` entry), the AutomationBar
  // discovers the bound id from the first `loop_started` WS frame.
  // That frame must populate `boundLoopId` so the subsequent
  // terminal-event filter has a concrete id to match against.
  it("populates the bound Loop id from the first loop_started WS frame on a fresh project", async () => {
    mockListAgentInstances.mockResolvedValue([
      { agent_instance_id: "agent-1", instance_role: "chat" },
    ]);
    mockGetLoopStatus.mockResolvedValue({ active_agent_instances: [], paused: false });
    renderBar();
    await waitFor(() => expect(mockListAgentInstances).toHaveBeenCalledWith("proj-1"));

    act(() => {
      fireEvent("loop_started", {
        project_id: "proj-1",
        agent_id: "loop-agent-fresh",
        content: {},
      });
    });

    await waitFor(() =>
      expect(useAutomationLoopStore.getState().getLoopAgent("proj-1" as ProjectId)).toBe(
        "loop-agent-fresh",
      ),
    );

    // An ephemeral teardown after the bound id has been discovered
    // must still be ignored — the bar should stay in `preparing` (no
    // task_started yet) rather than dropping to idle.
    act(() => {
      fireEvent("loop_finished", {
        project_id: "proj-1",
        agent_id: "ephemeral-runner-1",
        content: {},
      });
    });

    expect(screen.getByTestId("status")).toHaveTextContent("preparing");
  });
});
