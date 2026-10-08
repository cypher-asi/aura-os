import { describe, expect, it } from "vitest";
import type { DisplaySessionEvent } from "../../../shared/types/stream";
import { collectSessionImages } from "./collect-session-images";

describe("collectSessionImages", () => {
  it("keeps all ten URL-only photos after two persisted five-photo turns", () => {
    const messages: DisplaySessionEvent[] = [0, 1].map((batch) => ({
      id: `batch-${batch}`,
      role: "user",
      content: "Research these photos",
      contentBlocks: Array.from({ length: 5 }, (_, index) => ({
        type: "image" as const,
        media_type: "image/jpeg",
        data: "",
        source_url: `https://cdn.example/batch-${batch}/photo-${index}.jpg`,
      })),
    }));
    const images = collectSessionImages(messages);
    expect(images).toHaveLength(10);
    expect(images.map((image) => image.src)).toEqual(messages.flatMap((message) =>
      message.contentBlocks!.map((block) => (block as { source_url: string }).source_url),
    ));
  });

  it("returns an empty array for an empty / missing thread", () => {
    expect(collectSessionImages(undefined)).toEqual([]);
    expect(collectSessionImages([])).toEqual([]);
  });

  it("collects user attachments and assistant generations in chronological order with stable ids", () => {
    const messages: DisplaySessionEvent[] = [
      {
        id: "u-1",
        role: "user",
        content: "",
        contentBlocks: [
          { type: "text", text: "First prompt" },
          {
            type: "image",
            media_type: "image/png",
            data: "AAAA",
            source_url: "https://cdn/upload-a.png",
          },
        ],
      },
      {
        id: "a-1",
        role: "assistant",
        content: "Here you go",
        toolCalls: [
          {
            id: "tc-gen-1",
            name: "generate_image",
            input: { prompt: "futuristic house" },
            pending: false,
            result: JSON.stringify({
              imageUrl: "https://cdn/gen-1.png",
              originalUrl: "https://cdn/gen-1-orig.png",
              prompt: "futuristic house",
            }),
          },
        ],
      },
      {
        id: "u-2",
        role: "user",
        content: "",
        contentBlocks: [
          {
            type: "image",
            media_type: "image/jpeg",
            data: "BBBB",
          },
          {
            type: "image",
            media_type: "image/png",
            data: "CCCC",
            source_url: "https://cdn/upload-c.png",
          },
        ],
      },
      {
        id: "a-2",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc-gen-2",
            name: "generate_image",
            input: {},
            pending: false,
            result: JSON.stringify({
              payload: { image_url: "https://cdn/gen-2.png" },
            }),
          },
        ],
      },
    ];

    const items = collectSessionImages(messages);
    expect(items.map((i) => i.id)).toEqual([
      "u-1-img-1",
      "tc-gen-1",
      "u-2-img-0",
      "u-2-img-1",
      "tc-gen-2",
    ]);
    expect(items[0]).toMatchObject({
      id: "u-1-img-1",
      src: "https://cdn/upload-a.png",
      alt: "Attached image",
    });
    expect(items[1]).toMatchObject({
      id: "tc-gen-1",
      src: "https://cdn/gen-1.png",
      downloadUrl: "https://cdn/gen-1-orig.png",
      caption: "futuristic house",
    });
    // Inline base64 attachment is encoded as a data: URL when no
    // source_url is set, matching what the bubble itself renders.
    expect(items[2].src).toBe("data:image/jpeg;base64,BBBB");
  });

  it("skips pending, errored, and non-image tool calls", () => {
    const messages: DisplaySessionEvent[] = [
      {
        id: "a-1",
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "tc-good",
            name: "generate_image",
            input: {},
            pending: false,
            result: JSON.stringify({ imageUrl: "https://cdn/ok.png" }),
          },
          {
            id: "tc-pending",
            name: "generate_image",
            input: {},
            pending: true,
          },
          {
            id: "tc-error",
            name: "generate_image",
            input: {},
            pending: false,
            isError: true,
            result: JSON.stringify({ message: "boom" }),
          },
          {
            id: "tc-other",
            name: "read_file",
            input: {},
            pending: false,
            result: JSON.stringify({ contents: "..." }),
          },
        ],
      },
    ];
    expect(collectSessionImages(messages).map((i) => i.id)).toEqual(["tc-good"]);
  });

  it("ignores messages with no images at all", () => {
    const messages: DisplaySessionEvent[] = [
      { id: "u-1", role: "user", content: "hello" },
      {
        id: "a-1",
        role: "assistant",
        content: "ack",
        toolCalls: [
          {
            id: "tc-1",
            name: "search_code",
            input: {},
            pending: false,
            result: JSON.stringify({ hits: [] }),
          },
        ],
      },
    ];
    expect(collectSessionImages(messages)).toEqual([]);
  });
});
