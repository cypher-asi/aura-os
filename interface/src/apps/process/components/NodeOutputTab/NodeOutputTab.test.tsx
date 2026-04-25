import { render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import { NodeOutputTab } from "./NodeOutputTab";
import type { ProcessNode } from "../../../../shared/types";

const {
  mockListRunEvents,
  mockListRunArtifacts,
  processStoreState,
  sidekickStoreState,
} = vi.hoisted(() => {
  const mockListRunEvents = vi.fn();
  const mockListRunArtifacts = vi.fn();

  const processStoreState = {
    runs: {
      "process-1": [
        {
          run_id: "run-1",
          process_id: "process-1",
          status: "completed",
          trigger: "manual",
          started_at: "2026-04-06T20:00:00.000Z",
          completed_at: "2026-04-06T20:00:05.000Z",
          error: null,
        },
      ],
    },
    events: {},
    setEvents: vi.fn(),
  };

  const sidekickStoreState = {
    nodeStatuses: {},
  };

  return {
    mockListRunEvents,
    mockListRunArtifacts,
    processStoreState,
    sidekickStoreState,
  };
});

vi.mock("react-router-dom", () => ({
  useParams: () => ({ processId: "process-1" }),
}));

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../stores/process-store", () => ({
  useProcessStore: (selector: (state: typeof processStoreState) => unknown) => selector(processStoreState),
}));

vi.mock("../../stores/process-sidekick-store", () => ({
  useProcessSidekickStore: (selector: (state: typeof sidekickStoreState) => unknown) => selector(sidekickStoreState),
}));

vi.mock("../../../../shared/api/process", () => ({
  processApi: {
    listRunEvents: (...args: unknown[]) => mockListRunEvents(...args),
    listRunArtifacts: (...args: unknown[]) => mockListRunArtifacts(...args),
  },
}));

vi.mock("../PinnedOutput", () => ({
  PinnedOutputField: () => null,
  PinOutputButton: () => <button type="button">Pin output</button>,
}));

vi.mock("../ProcessEventOutput", () => ({
  ProcessEventOutput: () => <div>Rendered output</div>,
}));

vi.mock("../ProcessSidekickContent/ArtifactCard", () => ({
  ArtifactCard: ({ artifact }: { artifact: { name: string } }) => <div>Artifact card {artifact.name}</div>,
}));

vi.mock("../../../../components/Preview/Preview.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

function makeNode(overrides: Partial<ProcessNode> = {}): ProcessNode {
  return {
    node_id: "node-1",
    process_id: "process-1",
    node_type: "artifact",
    label: "Structured output",
    config: {},
    ...overrides,
  } as ProcessNode;
}

describe("NodeOutputTab", () => {
  beforeEach(() => {
    processStoreState.setEvents.mockReset();
    mockListRunEvents.mockReset();
    mockListRunArtifacts.mockReset();

    mockListRunEvents.mockResolvedValue([
      {
        event_id: "event-1",
        process_id: "process-1",
        run_id: "run-1",
        node_id: "node-1",
        status: "completed",
        input_snapshot: "",
        output: "done",
        started_at: "2026-04-06T20:00:00.000Z",
        completed_at: "2026-04-06T20:00:05.000Z",
      },
    ]);
    mockListRunArtifacts.mockResolvedValue([
      {
        artifact_id: "artifact-1",
        process_id: "process-1",
        run_id: "run-1",
        node_id: "node-1",
        artifact_type: "document",
        name: "structured_output.txt",
        file_path: "/tmp/structured_output.txt",
        size_bytes: 70000,
        created_at: "2026-04-06T20:00:05.000Z",
      },
    ]);
  });

  it("shows artifacts above the node output section and uses the shared artifact card", async () => {
    render(<NodeOutputTab node={makeNode()} />);

    expect(await screen.findByText("Artifacts")).toBeInTheDocument();
    expect(await screen.findByText("Output")).toBeInTheDocument();
    expect(await screen.findByText("Artifact card structured_output.txt")).toBeInTheDocument();

    await waitFor(() => {
      const content = document.body.textContent ?? "";
      expect(content.indexOf("Artifacts")).toBeGreaterThan(-1);
      expect(content.indexOf("Output")).toBeGreaterThan(-1);
      expect(content.indexOf("Artifacts")).toBeLessThan(content.indexOf("Output"));
    });
  });
});
