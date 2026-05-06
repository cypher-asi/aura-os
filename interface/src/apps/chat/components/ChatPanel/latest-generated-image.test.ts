import { describe, expect, it } from "vitest";
import type { DisplaySessionEvent } from "../../../../shared/types/stream";
import { findLatestGeneratedImage } from "./latest-generated-image";

function evt(
  id: string,
  toolCalls?: DisplaySessionEvent["toolCalls"],
): DisplaySessionEvent {
  return {
    id,
    role: "assistant",
    content: "",
    toolCalls,
  };
}

describe("findLatestGeneratedImage", () => {
  it("returns null for an empty / missing thread", () => {
    expect(findLatestGeneratedImage(undefined)).toBeNull();
    expect(findLatestGeneratedImage([])).toBeNull();
  });

  it("returns null when no `generate_image` tool result exists", () => {
    const messages: DisplaySessionEvent[] = [
      { id: "u-1", role: "user", content: "hello" },
      evt("a-1", [
        {
          id: "tc-1",
          name: "search_files",
          input: {},
          result: JSON.stringify({ files: [] }),
        },
      ]),
    ];
    expect(findLatestGeneratedImage(messages)).toBeNull();
  });

  it("returns the most recent successful generated image", () => {
    const messages: DisplaySessionEvent[] = [
      evt("a-1", [
        {
          id: "tc-old",
          name: "generate_image",
          input: { prompt: "old fox" },
          result: JSON.stringify({
            imageUrl: "https://cdn/fox.png",
            artifactId: "art-old",
          }),
        },
      ]),
      evt("a-2", [
        {
          id: "tc-new",
          name: "generate_image",
          input: { prompt: "new owl" },
          result: JSON.stringify({
            imageUrl: "https://cdn/owl.png",
            originalUrl: "https://cdn/owl-orig.png",
            artifactId: "art-new",
          }),
        },
      ]),
    ];
    expect(findLatestGeneratedImage(messages)).toEqual({
      id: "tc-new",
      imageUrl: "https://cdn/owl.png",
      originalUrl: "https://cdn/owl-orig.png",
      artifactId: "art-new",
      prompt: "new owl",
    });
  });

  it("ignores pending and errored generations", () => {
    const messages: DisplaySessionEvent[] = [
      evt("a-1", [
        {
          id: "tc-good",
          name: "generate_image",
          input: {},
          result: JSON.stringify({ imageUrl: "https://cdn/keep.png" }),
        },
      ]),
      evt("a-2", [
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
          isError: true,
          result: JSON.stringify({ message: "oops" }),
        },
      ]),
    ];
    expect(findLatestGeneratedImage(messages)?.id).toBe("tc-good");
  });

  it("falls back through alternate field shapes (snake_case, payload wrapper)", () => {
    const messages: DisplaySessionEvent[] = [
      evt("a-1", [
        {
          id: "tc-1",
          name: "generate_image",
          input: {},
          result: JSON.stringify({
            payload: {
              image_url: "https://cdn/wrapped.png",
              original_url: "https://cdn/wrapped-orig.png",
            },
          }),
        },
      ]),
    ];
    expect(findLatestGeneratedImage(messages)).toMatchObject({
      imageUrl: "https://cdn/wrapped.png",
      originalUrl: "https://cdn/wrapped-orig.png",
    });
  });
});
