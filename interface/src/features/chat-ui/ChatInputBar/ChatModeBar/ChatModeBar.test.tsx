import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

vi.mock("./ChatModeBar.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { ChatModeBar } from "./ChatModeBar";

describe("ChatModeBar", () => {
  it("renders the detached selector when no new-chat handler is wired", () => {
    render(<ChatModeBar selectedMode="code" onModeChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: /Code/ })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Start new chat" }),
    ).not.toBeInTheDocument();
  });

  it("renders the tab row with new-chat and collapse affordances", () => {
    const onNewChat = vi.fn();
    render(
      <ChatModeBar
        selectedMode="code"
        onModeChange={vi.fn()}
        onNewChat={onNewChat}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Start new chat" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hide modes" })).toBeInTheDocument();
  });

  it("collapses and restores the mode pills via the chevron", async () => {
    const user = userEvent.setup();
    render(
      <ChatModeBar
        selectedMode="code"
        onModeChange={vi.fn()}
        onNewChat={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Hide modes" }));
    expect(screen.queryByRole("radio", { name: /Code/ })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show modes" }));
    expect(screen.getByRole("radio", { name: /Code/ })).toBeInTheDocument();
  });

  it("forwards mode picks", async () => {
    const user = userEvent.setup();
    const onModeChange = vi.fn();
    render(
      <ChatModeBar
        selectedMode="code"
        onModeChange={onModeChange}
        onNewChat={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("radio", { name: /Plan/ }));
    expect(onModeChange).toHaveBeenCalledWith("plan");
  });
});
