import { render, screen } from "@testing-library/react";
import { ImageBlock } from "./ImageBlock";
import type { ToolCallEntry } from "../../../shared/types/stream";

vi.mock("./renderers.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("../Block.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

function entry(result: Record<string, unknown>): ToolCallEntry {
  return {
    id: "gen-1",
    name: "generate_image",
    input: {},
    result: JSON.stringify(result),
    pending: false,
  };
}

describe("ImageBlock", () => {
  it("renders artifact-style assetUrl results", () => {
    render(
      <ImageBlock
        entry={entry({
          assetUrl: "https://cdn.example.com/cat.png",
          originalUrl: "https://cdn.example.com/cat-original.png",
        })}
      />,
    );

    expect(screen.getByRole("img", { name: "Generated image" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/cat.png",
    );
    // The image is wrapped in a button that opens the shared gallery
    // overlay rather than navigating away in a new tab.
    expect(
      screen.getByRole("button", { name: /open generated image in gallery/i }),
    ).toBeInTheDocument();
  });

  it("renders nested payload asset_url results", () => {
    render(
      <ImageBlock
        entry={entry({
          payload: {
            asset_url: "https://cdn.example.com/nested-cat.png",
          },
        })}
      />,
    );

    expect(screen.getByRole("img", { name: "Generated image" })).toHaveAttribute(
      "src",
      "https://cdn.example.com/nested-cat.png",
    );
  });
});
