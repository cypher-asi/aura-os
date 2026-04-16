import { fireEvent, render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThinkingRow } from "./ThinkingRow";

vi.mock("./ThinkingRow.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

describe("ThinkingRow", () => {
  const getWrap = (container: HTMLElement) =>
    container.querySelector("[aria-hidden]") as HTMLElement | null;

  const isVisible = (container: HTMLElement) =>
    getWrap(container)?.getAttribute("aria-hidden") === "false";

  it("stays expanded when streaming finishes (no auto-collapse)", () => {
    const { container, rerender } = render(
      <ThinkingRow text="Considering options" isStreaming defaultExpanded />,
    );
    expect(isVisible(container)).toBe(true);

    rerender(
      <ThinkingRow text="Considering options" isStreaming={false} defaultExpanded />,
    );
    expect(isVisible(container)).toBe(true);
  });

  it("is collapsed from frame 0 for historical (non-streaming, no default) rows", () => {
    const { container } = render(
      <ThinkingRow text="Considering options" isStreaming={false} />,
    );
    expect(isVisible(container)).toBe(false);
  });

  it("stays expanded while streaming", () => {
    const { container } = render(
      <ThinkingRow text="Considering options" isStreaming />,
    );
    expect(isVisible(container)).toBe(true);
  });

  it("toggles expansion when the label is clicked", () => {
    const { container, getByRole } = render(
      <ThinkingRow text="Considering options" isStreaming={false} />,
    );

    expect(isVisible(container)).toBe(false);
    fireEvent.click(getByRole("button"));
    expect(isVisible(container)).toBe(true);
    fireEvent.click(getByRole("button"));
    expect(isVisible(container)).toBe(false);
  });

  it("keeps the thinking content node mounted even while collapsed", () => {
    const { getByText } = render(
      <ThinkingRow text="Hidden but mounted" isStreaming={false} />,
    );
    // Node stays in DOM so the grid-template-rows transition can animate
    // the wrapper height from 0fr <-> 1fr without measuring the content.
    expect(getByText("Hidden but mounted")).toBeInTheDocument();
  });
});
