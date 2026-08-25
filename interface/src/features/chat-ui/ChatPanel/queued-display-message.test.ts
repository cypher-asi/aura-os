import { describe, expect, it } from "vitest";
import type { QueuedMessage } from "../../../stores/message-queue-store";
import {
  appendQueuedDisplayMessages,
  queuedMessageToDisplayEvent,
} from "./queued-display-message";

describe("queuedMessageToDisplayEvent", () => {
  it("uses the queue id as the stable transcript identity", () => {
    const queued: QueuedMessage = {
      id: "q-123",
      content: "  keep this visible  ",
      action: null,
      attachments: [
        {
          type: "text",
          name: "context.txt",
          data: btoa("hello"),
          media_type: "text/plain",
        },
      ],
    };

    expect(queuedMessageToDisplayEvent(queued)).toMatchObject({
      id: "q-123",
      clientId: "q-123",
      role: "user",
      content: "keep this visible",
      deliveryStatus: "queued",
    });
  });

  it("uses the same fallback label as a queued generate-specs send", () => {
    expect(
      queuedMessageToDisplayEvent({
        id: "q-specs",
        content: "",
        action: "generate_specs",
      }),
    ).toMatchObject({
      content: "Generate specs for this project",
      deliveryStatus: "queued",
    });
  });

  it("appends queued prompts to the visible transcript without duplicating a promoted item", () => {
    const queued: QueuedMessage[] = [
      { id: "q-visible", content: "Visible now", action: null },
      { id: "q-promoted", content: "Already dispatched", action: null },
    ];
    const transcript = [
      { id: "assistant-1", role: "assistant" as const, content: "Working" },
      {
        id: "server-user-1",
        clientId: "q-promoted",
        role: "user" as const,
        content: "Already dispatched",
      },
    ];

    expect(appendQueuedDisplayMessages(transcript, queued).map((event) => event.clientId ?? event.id))
      .toEqual(["assistant-1", "q-promoted", "q-visible"]);
  });
});
