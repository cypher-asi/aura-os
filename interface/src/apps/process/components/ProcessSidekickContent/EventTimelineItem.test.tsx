import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ProcessEvent } from "../../../../types";
import { EventTimelineItem } from "./EventTimelineItem";

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../../stores/process-store", () => ({
  useProcessStore: vi.fn(),
}));

vi.mock("../../../../stores/event-store/index", () => ({
  useEventStore: vi.fn((selector: (state: { connected: boolean }) => unknown) =>
    selector({ connected: true })),
}));

vi.mock("../../../../api/process", () => ({
  processApi: {
    listRunEvents: vi.fn(),
  },
}));

vi.mock("../ProcessEventOutput", () => ({
  ProcessEventOutput: () => <div>Process output</div>,
}));

function makeEvent(overrides: Partial<ProcessEvent> = {}): ProcessEvent {
  return {
    event_id: "evt-1",
    run_id: "run-1",
    node_id: "node-1",
    process_id: "proc-1",
    status: "running",
    input_snapshot: "{\"prompt\":\"Hello\"}",
    output: "",
    started_at: "2026-04-06T20:00:00.000Z",
    completed_at: null,
    ...overrides,
  };
}

describe("EventTimelineItem", () => {
  it("collapses the detail view when an active event completes", async () => {
    const event = makeEvent();
    const { rerender } = render(
      <EventTimelineItem
        event={event}
        nodes={[{ node_id: "node-1", label: "Draft reply" }]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Draft reply/i }));
    expect(screen.getByText((content) => content.includes('"prompt": "Hello"'))).toBeInTheDocument();

    rerender(
      <EventTimelineItem
        event={makeEvent({
          status: "completed",
          completed_at: "2026-04-06T20:00:05.000Z",
        })}
        nodes={[{ node_id: "node-1", label: "Draft reply" }]}
      />,
    );

    await waitFor(() => {
      expect(screen.queryByText((content) => content.includes('"prompt": "Hello"'))).not.toBeInTheDocument();
    });
  });
});
