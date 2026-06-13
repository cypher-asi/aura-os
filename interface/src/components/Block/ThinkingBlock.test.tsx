import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThinkingBlock } from "./ThinkingBlock";

vi.mock("./Block.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("./ThinkingBlock.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("../CopyButton/CopyButton.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

function expandableHeader() {
  return screen
    .getAllByRole("button")
    .find((el) => el.hasAttribute("aria-expanded"));
}

describe("ThinkingBlock", () => {
  it("is force-expanded with 'Thinking...' and visible text while streaming", () => {
    render(
      <ThinkingBlock text="reasoning in progress" isStreaming durationMs={null} />,
    );

    expect(screen.getByText("Thinking...")).toBeInTheDocument();
    expect(screen.getByText("reasoning in progress")).toBeInTheDocument();
    expect(expandableHeader()).toHaveAttribute("aria-expanded", "true");
  });

  it("collapses to a clickable 'Thought for Xs' summary once done", () => {
    render(
      <ThinkingBlock
        text="all done reasoning"
        isStreaming={false}
        durationMs={1500}
      />,
    );

    // Collapsed by default with the duration summary in the header.
    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
    expect(screen.getByText(/^Thought for/)).toBeInTheDocument();

    const header = expandableHeader();
    expect(header).toHaveAttribute("aria-expanded", "false");

    // Clicking the header re-expands the reasoning.
    fireEvent.click(header!);
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  it("renders 'Thought' with no duration when none was recorded", () => {
    render(
      <ThinkingBlock text="some reasoning" isStreaming={false} durationMs={null} />,
    );

    expect(screen.getByText("Thought")).toBeInTheDocument();
  });

  it("renders a caption-only header (no body, no toggle) while streaming with empty text", () => {
    const { container } = render(
      <ThinkingBlock text="" isStreaming durationMs={undefined} />,
    );

    expect(screen.getByText("Thinking...")).toBeInTheDocument();
    // No expand affordance and no prose body for the empty placeholder.
    expect(expandableHeader()).toBeUndefined();
    expect(container.querySelector(".thinkingText")).toBeNull();
    expect(container.querySelector(".blockBody")).toBeNull();
  });
});
