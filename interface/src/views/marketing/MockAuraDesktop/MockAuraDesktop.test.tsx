import { render, screen, fireEvent, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

// The mock chat reuses the REAL authenticated chat input
// (`DesktopChatInputBar`); it pulls in store/desktop-API modules that
// are awkward to mount in jsdom (the marketing `MockChatInputCard` test
// mocks it for the same reason). Stub it to a lightweight stand-in so
// these tests stay focused on the mock shell's own behavior.
vi.mock("../../../features/chat-ui/ChatInputBar", () => ({
  DesktopChatInputBar: () => <div data-testid="mock-chat-input" />,
}));

import { MockAuraDesktop } from "./MockAuraDesktop";

// Force the reduced-motion path so the scripted chat/sidekick timers
// settle instantly and the mock renders its final state deterministically
// (no lingering setTimeout chains to leak across tests).
beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: /prefers-reduced-motion/.test(query),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
});

describe("MockAuraDesktop", () => {
  it("opens on the first agent's chat", () => {
    render(<MockAuraDesktop />);
    expect(screen.getByTestId("mock-aura-desktop")).toBeInTheDocument();
    // Frontend is the default selected agent — its name shows in the chat header.
    expect(screen.getByTestId("mock-chat-agent")).toHaveTextContent("Frontend");
  });

  it("switches the chat when another agent is picked", () => {
    render(<MockAuraDesktop />);
    expect(screen.getByTestId("mock-chat-agent")).toHaveTextContent("Frontend");

    const backendRow = screen.getByText("Backend").closest("button");
    expect(backendRow).not.toBeNull();
    fireEvent.click(backendRow as HTMLButtonElement);

    expect(screen.getByTestId("mock-chat-agent")).toHaveTextContent("Backend");
  });

  it("toggles the left nav between Agents and Projects", () => {
    render(<MockAuraDesktop />);
    // Agents pane: the agent library lists the Architect agent.
    expect(screen.getByText("Architect")).toBeInTheDocument();

    // Scope to the sidebar toggle group — the taskbar app rail also
    // exposes "Agents"/"Projects" buttons via aria-label.
    const toggle = screen.getByRole("group", {
      name: /Switch between Agents and Projects/,
    });
    fireEvent.click(within(toggle).getByRole("button", { name: "Projects" }));

    // Projects pane: shows the project list, agent rows are gone.
    expect(screen.getByText("billing-service")).toBeInTheDocument();
    expect(screen.queryByText("Architect")).not.toBeInTheDocument();

    fireEvent.click(within(toggle).getByRole("button", { name: "Agents" }));
    expect(screen.getByText("Architect")).toBeInTheDocument();
  });

  it("renders the sidekick automation task list under reduced motion", () => {
    render(<MockAuraDesktop />);
    // Reduced motion settles the sidekick on the Tasks (automation) tab.
    expect(screen.getByText("Task automation")).toBeInTheDocument();
    const sidekick = screen.getByText("Task automation").closest("aside");
    expect(sidekick).not.toBeNull();
    expect(within(sidekick as HTMLElement).getByText("Build the dashboard layout")).toBeInTheDocument();
  });
});
