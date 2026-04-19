import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("./ChatInputBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { ContextUsageIndicator } from "./ContextUsageIndicator";

describe("ContextUsageIndicator", () => {
  it("renders the rounded percentage as the inline trigger", () => {
    render(<ContextUsageIndicator utilization={0.42} />);
    expect(screen.getByRole("button", { name: /42%/ })).toBeInTheDocument();
  });

  it("shows used and total tokens in the popover on hover", async () => {
    const user = userEvent.setup();
    render(
      <ContextUsageIndicator utilization={0.25} estimatedTokens={50_000} />,
    );

    const trigger = screen.getByRole("button", { name: /25%/ });
    await user.hover(trigger);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("25% used");
    expect(dialog).toHaveTextContent("50,000 tokens");
    expect(dialog).toHaveTextContent("200,000 tokens");
  });

  it("hides token rows when estimatedTokens are missing", async () => {
    const user = userEvent.setup();
    render(<ContextUsageIndicator utilization={0.42} />);

    await user.hover(screen.getByRole("button", { name: /42%/ }));

    const dialog = await screen.findByRole("dialog");
    expect(dialog).not.toHaveTextContent("Used");
    expect(dialog).not.toHaveTextContent("Total");
    expect(dialog).toHaveTextContent(
      /Token counts appear after the next assistant turn/,
    );
  });

  it("renders a reset button that calls onNewSession", async () => {
    const user = userEvent.setup();
    const onNewSession = vi.fn();
    render(
      <ContextUsageIndicator utilization={0.42} onNewSession={onNewSession} />,
    );

    await user.click(
      screen.getByRole("button", { name: "Start new session" }),
    );
    expect(onNewSession).toHaveBeenCalledOnce();
  });

  it("pins the popover open after click", async () => {
    const user = userEvent.setup();
    render(
      <ContextUsageIndicator utilization={0.42} estimatedTokens={10_000} />,
    );

    const trigger = screen.getByRole("button", { name: /42%/ });
    await user.click(trigger);
    await user.unhover(trigger);

    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
