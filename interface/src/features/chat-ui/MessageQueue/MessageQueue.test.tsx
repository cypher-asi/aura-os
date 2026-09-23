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
});
