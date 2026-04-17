import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { FolderSection } from "./FolderSection";

vi.mock("./FolderSection.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

describe("FolderSection", () => {
  it("renders the label and children when expanded", () => {
    render(
      <FolderSection label="Trending" expanded onToggle={() => {}}>
        <div>child</div>
      </FolderSection>,
    );

    expect(screen.getByRole("button", { name: /trending/i })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("hides children when collapsed", () => {
    render(
      <FolderSection label="Type" expanded={false} onToggle={() => {}}>
        <div>hidden child</div>
      </FolderSection>,
    );

    expect(screen.queryByText("hidden child")).not.toBeInTheDocument();
  });

  it("calls onToggle when the header button is clicked", () => {
    const onToggle = vi.fn();
    render(
      <FolderSection label="Status" expanded onToggle={onToggle}>
        <div />
      </FolderSection>,
    );

    fireEvent.click(screen.getByRole("button", { name: /status/i }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("toggles on ArrowLeft when expanded and ArrowRight when collapsed", () => {
    const onToggle = vi.fn();
    const { rerender } = render(
      <FolderSection label="Type" expanded onToggle={onToggle}>
        <div />
      </FolderSection>,
    );

    const button = screen.getByRole("button", { name: /type/i });
    fireEvent.keyDown(button, { key: "ArrowLeft" });
    expect(onToggle).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(button, { key: "ArrowRight" });
    expect(onToggle).toHaveBeenCalledTimes(1);

    rerender(
      <FolderSection label="Type" expanded={false} onToggle={onToggle}>
        <div />
      </FolderSection>,
    );
    fireEvent.keyDown(screen.getByRole("button", { name: /type/i }), {
      key: "ArrowRight",
    });
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
