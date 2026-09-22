import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  setQuery: vi.fn(),
}));

vi.mock("../../../hooks/use-sidebar-search", () => ({
  useSidebarSearch: () => ({
    query: "",
    setQuery: mocks.setQuery,
  }),
}));

vi.mock("../../../components/PanelSearch", () => ({
  PanelSearch: ({
    placeholder,
    value,
    onChange,
  }: {
    placeholder: string;
    value: string;
    onChange: (value: string) => void;
  }) => (
    <input
      aria-label={placeholder}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

vi.mock("../../../apps/agents/AgentList", () => ({
  AgentList: ({ mode }: { mode: string }) => (
    <div data-testid="agent-list" data-mode={mode} />
  ),
}));

vi.mock("../PendingAgentSends", () => ({
  PendingAgentSends: () => <div data-testid="pending-agent-sends" />,
}));

import { MobileAgentLibraryView } from "./MobileAgentLibraryView";

describe("MobileAgentLibraryView", () => {
  it("exposes touch-native search for agents and shared conversations", () => {
    render(<MobileAgentLibraryView />);

    fireEvent.change(
      screen.getByRole("textbox", { name: "Search agents and conversations" }),
      { target: { value: "desktop migration" } },
    );

    expect(mocks.setQuery).toHaveBeenCalledWith("desktop migration");
    expect(screen.getByTestId("agent-list")).toHaveAttribute(
      "data-mode",
      "mobile-library",
    );
    expect(screen.getByTestId("pending-agent-sends")).toBeInTheDocument();
  });
});
