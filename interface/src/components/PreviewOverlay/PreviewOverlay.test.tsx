import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@cypher-asi/zui", () => ({
  Button: (props: any) => (
    <button onClick={props.onClick} aria-label={props["aria-label"]}>
      {props.icon}{props.children}
    </button>
  ),
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" "),
}));

vi.mock("./PreviewOverlay.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { PreviewOverlay } from "./PreviewOverlay";

describe("PreviewOverlay", () => {
  it("renders title and children", () => {
    render(
      <PreviewOverlay title="Test Title" onClose={() => {}}>
        <div>Child content</div>
      </PreviewOverlay>
    );
    expect(screen.getByText("Test Title")).toBeDefined();
    expect(screen.getByText("Child content")).toBeDefined();
  });

  it("shows back button only when canGoBack with onBack", () => {
    const onBack = vi.fn();
    const { rerender } = render(
      <PreviewOverlay title="T" onClose={() => {}} canGoBack={false} onBack={onBack}>
        <div />
      </PreviewOverlay>
    );
    expect(screen.queryByLabelText("Back")).toBeNull();

    rerender(
      <PreviewOverlay title="T" onClose={() => {}} canGoBack={true} onBack={onBack}>
        <div />
      </PreviewOverlay>
    );
    expect(screen.getByLabelText("Back")).toBeDefined();
  });

  it("close button fires onClose", () => {
    const onClose = vi.fn();
    render(
      <PreviewOverlay title="T" onClose={onClose}>
        <div />
      </PreviewOverlay>
    );
    fireEvent.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("back button fires onBack", () => {
    const onBack = vi.fn();
    render(
      <PreviewOverlay title="T" onClose={() => {}} canGoBack onBack={onBack}>
        <div />
      </PreviewOverlay>
    );
    fireEvent.click(screen.getByLabelText("Back"));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("renders actions slot", () => {
    render(
      <PreviewOverlay title="T" onClose={() => {}} actions={<button type="button">Action</button>}>
        <div />
      </PreviewOverlay>
    );
    expect(screen.getByText("Action")).toBeDefined();
  });
});
