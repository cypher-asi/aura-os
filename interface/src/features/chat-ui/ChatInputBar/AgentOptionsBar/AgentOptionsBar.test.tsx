import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

vi.mock("./AgentOptionsBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { AgentOptionsBar, type AgentOptionsBarProps } from "./AgentOptionsBar";

function renderBar(overrides: Partial<AgentOptionsBarProps> = {}) {
  const props: AgentOptionsBarProps = {
    streamKey: "s1",
    adapterType: "claude_code",
    defaultModel: "claude",
    councilCount: 1,
    councilMechanism: "synthesize",
    answerStrategy: "single",
    setCouncilCount: vi.fn(),
    setCouncilMechanism: vi.fn(),
    setAnswerStrategy: vi.fn(),
    ...overrides,
  };
  render(<AgentOptionsBar {...props} />);
  return props;
}

describe("AgentOptionsBar", () => {
  it("marks single (1x) active by default", () => {
    renderBar();
    expect(screen.getByRole("button", { name: /^1x$/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.getByRole("button", { name: /Second Opinion/ }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("enables Second Opinion, clearing council via the store", async () => {
    const user = userEvent.setup();
    const props = renderBar();
    await user.click(screen.getByRole("button", { name: /Second Opinion/ }));
    expect(props.setAnswerStrategy).toHaveBeenCalledWith(
      "s1",
      "second_opinion",
      "claude_code",
      "claude",
    );
  });

  it("toggles Second Opinion back to single when already active", async () => {
    const user = userEvent.setup();
    const props = renderBar({ answerStrategy: "second_opinion" });
    const btn = screen.getByRole("button", { name: /Second Opinion/ });
    expect(btn).toHaveAttribute("aria-pressed", "true");
    await user.click(btn);
    expect(props.setAnswerStrategy).toHaveBeenCalledWith(
      "s1",
      "single",
      "claude_code",
      "claude",
    );
  });

  it("returns to single model when 1x is clicked", async () => {
    const user = userEvent.setup();
    const props = renderBar({ councilCount: 3 });
    await user.click(screen.getByRole("button", { name: /^1x$/ }));
    expect(props.setCouncilCount).toHaveBeenCalledWith("s1", 1);
    expect(props.setAnswerStrategy).toHaveBeenCalledWith(
      "s1",
      "single",
      "claude_code",
      "claude",
    );
  });

  it("picks a council member count from the hover flyout", async () => {
    const user = userEvent.setup();
    const props = renderBar();
    await user.hover(screen.getByRole("button", { name: /AURA Council/ }));
    await user.click(screen.getByRole("button", { name: /3x/ }));
    expect(props.setCouncilCount).toHaveBeenCalledWith("s1", 3);
  });

  it("shows the combine-mechanism dropdown only once council is active", async () => {
    const user = userEvent.setup();
    const props = renderBar({ councilCount: 2, councilMechanism: "synthesize" });
    // Trigger reflects the current mechanism.
    await user.click(screen.getByRole("button", { name: /Synthesize/ }));
    await user.click(screen.getByRole("button", { name: /Contrast/ }));
    expect(props.setCouncilMechanism).toHaveBeenCalledWith("s1", "contrast");
  });

  it("hides the mechanism dropdown when council is off", () => {
    renderBar({ councilCount: 1 });
    expect(
      screen.queryByRole("button", { name: /Synthesize/ }),
    ).not.toBeInTheDocument();
  });
});
