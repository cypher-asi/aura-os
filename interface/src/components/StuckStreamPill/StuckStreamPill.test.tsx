import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { StuckStreamPill } from "./StuckStreamPill";

vi.mock("./StuckStreamPill.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

describe("StuckStreamPill", () => {
  it("renders the elapsed-time copy with seconds derived from stuckForMs", () => {
    render(
      <StuckStreamPill
        stuckForMs={15_000}
        onStop={() => {}}
        onRetry={() => {}}
        onReport={() => {}}
      />,
    );

    // 15s past the 30s stuck threshold => last activity 45s ago.
    expect(
      screen.getByText("Agent paused for 15s — last activity was 45s ago"),
    ).toBeInTheDocument();
  });

  it("renders 0s without crashing when stuckForMs is null", () => {
    render(
      <StuckStreamPill
        stuckForMs={null}
        onStop={() => {}}
        onRetry={() => {}}
        onReport={() => {}}
      />,
    );

    // Null collapses to zero-second elapsed; last activity is the
    // 30s stuck threshold itself.
    expect(
      screen.getByText("Agent paused for 0s — last activity was 30s ago"),
    ).toBeInTheDocument();
  });

  it("fires onStop, onRetry, and onReport when the matching button is clicked", async () => {
    const onStop = vi.fn();
    const onRetry = vi.fn();
    const onReport = vi.fn();
    const user = userEvent.setup();
    render(
      <StuckStreamPill
        stuckForMs={5_000}
        onStop={onStop}
        onRetry={onRetry}
        onReport={onReport}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Stop" }));
    expect(onStop).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Restart turn" }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Report" }));
    expect(onReport).toHaveBeenCalledTimes(1);
  });

  it("uses an aria-live polite live region for screen-reader announcements", () => {
    render(
      <StuckStreamPill
        stuckForMs={1_000}
        onStop={() => {}}
        onRetry={() => {}}
        onReport={() => {}}
      />,
    );

    const region = screen.getByRole("status");
    expect(region).toHaveAttribute("aria-live", "polite");
  });
});
