import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useMessageQueueStore } from "../../../stores/message-queue-store";
import { MessageQueue } from "./MessageQueue";

vi.mock("../../../hooks/stream/hooks", () => ({
  useIsStreaming: () => false,
}));

describe("MessageQueue", () => {
  beforeEach(() => {
    useMessageQueueStore.setState({ queues: {}, hydrated: true });
  });

  it("opens a restored queue and requires an explicit resume action", () => {
    const onResume = vi.fn();
    useMessageQueueStore.setState({
      queues: {
        "agent:a:session:s": [
          {
            id: "q-restored",
            content: "Continue the refactor",
            action: null,
            heldAfterRestart: true,
          },
        ],
      },
    });

    render(
      <MessageQueue
        streamKey="agent:a:session:s"
        onEdit={vi.fn()}
        onRemove={vi.fn()}
        onResume={onResume}
      />,
    );

    expect(screen.getByText("1 held after restart")).toBeInTheDocument();
    expect(screen.getByText("Continue the refactor")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Resume queue" }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("offers ordering controls and disables moves past queue boundaries", () => {
    const onMove = vi.fn();
    useMessageQueueStore.setState({ queues: { s: [
      { id: "first", content: "First", action: null },
      { id: "second", content: "Second", action: null },
    ] } });
    render(<MessageQueue streamKey="s" onEdit={vi.fn()} onRemove={vi.fn()} onMove={onMove} />);
    fireEvent.click(screen.getByRole("button", { name: "2 Queued" }));
    expect(screen.getByRole("button", { name: "Move queued message 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move queued message 2 down" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Move queued message 2 up" }));
    expect(onMove).toHaveBeenLastCalledWith("second", "up");
    fireEvent.click(screen.getByRole("button", { name: "Move queued message 1 down" }));
    expect(onMove).toHaveBeenLastCalledWith("first", "down");
  });
});
