import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BrowserDesignToolbar } from "./BrowserDesignToolbar";

describe("BrowserDesignToolbar", () => {
  it("keeps compact mode controls labeled and reports the active viewport", () => {
    render(
      <BrowserDesignToolbar
        mode="preview"
        viewportPreset="desktop"
        onModeChange={() => {}}
        onViewportPresetChange={() => {}}
      />,
    );

    expect(screen.getByRole("button", { name: "Preview" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Design" })).toHaveAttribute(
      "title",
      "Design",
    );
    expect(screen.getByText("1440 × 900")).toBeInTheDocument();
  });

  it("changes mode and viewport from their compact icon controls", () => {
    const onModeChange = vi.fn();
    const onViewportPresetChange = vi.fn();

    render(
      <BrowserDesignToolbar
        mode="preview"
        viewportPreset="fit"
        onModeChange={onModeChange}
        onViewportPresetChange={onViewportPresetChange}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Design" }));
    fireEvent.click(screen.getByRole("button", { name: "Mobile" }));

    expect(onModeChange).toHaveBeenCalledWith("design");
    expect(onViewportPresetChange).toHaveBeenCalledWith("mobile");
  });
});
