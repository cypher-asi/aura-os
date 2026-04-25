import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import type { ProcessRun } from "../../../../shared/types";
import { RunPreviewBody } from "./RunPreviewBody";

const {
  mockListRunArtifacts,
  mockListRunEvents,
  mockGetRun,
  mockFetchRuns,
  mockSetEvents,
  mockSubscribe,
  sidekickStoreState,
  useProcessStoreMock,
  useProcessSidekickStoreMock,
  useEventStoreMock,
} = vi.hoisted(() => {
  const mockListRunArtifacts = vi.fn();
  const mockListRunEvents = vi.fn();
  const mockGetRun = vi.fn();
  const mockFetchRuns = vi.fn();
  const mockSetEvents = vi.fn();
  const mockSubscribe = vi.fn(() => vi.fn());

  const processStoreState = {
    nodes: {
      "process-1": [{ node_id: "node-1", label: "Draft reply" }],
    },
    connections: {
      "process-1": [],
    },
    fetchRuns: mockFetchRuns,
    setEvents: mockSetEvents,
    events: {},
  };

  const sidekickStoreState = {
    nodeStatuses: {},
    liveRunNodeId: null as string | null,
  };

  const useProcessStoreMock = vi.fn((selector: (state: typeof processStoreState) => unknown) => selector(processStoreState));
  const useProcessSidekickStoreMock = vi.fn((selector: (state: typeof sidekickStoreState) => unknown) => selector(sidekickStoreState));
  const useEventStoreMock = Object.assign(
    vi.fn((selector: (state: { connected: boolean }) => unknown) => selector({ connected: false })),
    {
      getState: () => ({
        subscribe: mockSubscribe,
      }),
    },
  );

  return {
    mockListRunArtifacts,
    mockListRunEvents,
    mockGetRun,
    mockFetchRuns,
    mockSetEvents,
    mockSubscribe,
    sidekickStoreState,
    useProcessStoreMock,
    useProcessSidekickStoreMock,
    useEventStoreMock,
  };
});

vi.mock("../../stores/process-store", () => ({
  useProcessStore: useProcessStoreMock,
}));

vi.mock("../../stores/process-sidekick-store", () => ({
  useProcessSidekickStore: useProcessSidekickStoreMock,
}));

vi.mock("../../../../stores/event-store/index", () => ({
  useEventStore: useEventStoreMock,
}));

vi.mock("../../../../api/process", () => ({
  processApi: {
    listRunArtifacts: (...args: unknown[]) => mockListRunArtifacts(...args),
    listRunEvents: (...args: unknown[]) => mockListRunEvents(...args),
    getRun: (...args: unknown[]) => mockGetRun(...args),
  },
}));

vi.mock("../../../../components/StreamingBubble", () => ({
  StreamingBubble: () => <div>Streaming bubble</div>,
}));

vi.mock("../../../../components/MessageBubble", () => ({
  MessageBubble: ({ message }: { message: { id: string } }) => <div>Message {message.id}</div>,
}));

vi.mock("../../../../hooks/use-process-node-stream", () => ({
  useProcessNodeStream: () => ({ streamKey: "stream-1" }),
}));

vi.mock("../../../../hooks/stream/hooks", () => ({
  useStreamEvents: () => [],
  useStreamingText: () => "",
  useThinkingText: () => "",
  useThinkingDurationMs: () => null,
  useActiveToolCalls: () => [],
  useTimeline: () => [],
  useIsStreaming: () => false,
}));

vi.mock("./EventTimelineItem", () => ({
  EventTimelineItem: ({ event }: { event: { node_id: string } }) => <div>Event {event.node_id}</div>,
}));

vi.mock("./ArtifactCard", () => ({
  ArtifactCard: ({ artifact }: { artifact: { name: string } }) => <div>Artifact {artifact.name}</div>,
}));

vi.mock("./LiveRunBanner", () => ({
  LiveRunBanner: () => <div>Live banner</div>,
}));

vi.mock("./process-sidekick-utils", () => ({
  injectKeyframes: vi.fn(),
  useElapsedTime: () => "00:05",
  formatDuration: () => "5s",
  countRunnableProcessNodes: () => 1,
  EMPTY_NODES: [],
}));

vi.mock("./process-output-utils", () => ({
  buildProcessSidekickCopyText: () => "copied output",
}));

function makeRun(overrides: Partial<ProcessRun> = {}): ProcessRun {
  return {
    run_id: "run-1",
    process_id: "process-1",
    status: "completed",
    trigger: "manual",
    started_at: "2026-04-06T20:00:00.000Z",
    completed_at: "2026-04-06T20:00:05.000Z",
    error: null,
    total_input_tokens: null,
    total_output_tokens: null,
    cost_usd: null,
    ...overrides,
  } as ProcessRun;
}

describe("RunPreviewBody", () => {
  beforeEach(() => {
    mockListRunArtifacts.mockReset();
    mockListRunEvents.mockReset();
    mockGetRun.mockReset();
    mockFetchRuns.mockReset();
    mockSetEvents.mockReset();
    mockSubscribe.mockClear();
    sidekickStoreState.liveRunNodeId = null;

    mockListRunArtifacts.mockResolvedValue([
      {
        artifact_id: "artifact-1",
        name: "report.md",
      },
    ]);
    mockListRunEvents.mockResolvedValue([
      {
        event_id: "event-1",
        process_id: "process-1",
        run_id: "run-1",
        node_id: "node-1",
        status: "completed",
        input_snapshot: "",
        output: "",
        started_at: "2026-04-06T20:00:00.000Z",
        completed_at: "2026-04-06T20:00:05.000Z",
      },
    ]);
  });

  it("renders artifacts for completed runs", async () => {
    render(<RunPreviewBody run={makeRun()} />);

    await screen.findByText("Artifacts");

    await waitFor(() => {
      const content = document.body.textContent ?? "";
      expect(content.indexOf("Artifacts")).toBeGreaterThan(-1);
      expect(content.indexOf("Run Output")).toBe(-1);
    });
  });
});
