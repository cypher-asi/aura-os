import { act, render, screen } from "@testing-library/react";
import { useDesktopWindowStore } from "../../stores/desktop-window-store";

const renderCounts: Record<string, number> = {};

vi.mock("./AgentWindow", () => ({
  AgentWindow: ({
    win,
    isFocused,
  }: {
    win: { agentId: string; x: number; width: number };
    isFocused: boolean;
  }) => {
    renderCounts[win.agentId] = (renderCounts[win.agentId] ?? 0) + 1;
    return (
      <div
        data-testid={`agent-window-${win.agentId}`}
        data-focused={String(isFocused)}
        data-x={String(win.x)}
        data-width={String(win.width)}
      />
    );
  },
}));

import { DesktopWindowLayer } from "./DesktopWindowLayer";

function seedWindows() {
  useDesktopWindowStore.setState({
    windows: {
      a1: {
        agentId: "a1",
        x: 60,
        y: 180,
        width: 420,
        height: 520,
        zIndex: 1,
        minimized: false,
        maximized: false,
      },
      a2: {
        agentId: "a2",
        x: 88,
        y: 180,
        width: 420,
        height: 520,
        zIndex: 2,
        minimized: false,
        maximized: false,
      },
    },
    nextZ: 3,
  });
}

describe("DesktopWindowLayer", () => {
  beforeEach(() => {
    useDesktopWindowStore.setState({ windows: {}, nextZ: 1 });
    Object.keys(renderCounts).forEach((key) => delete renderCounts[key]);
  });

  it("rerenders only the changed window on move and resize updates", () => {
    seedWindows();
    render(<DesktopWindowLayer />);

    expect(renderCounts.a1).toBe(1);
    expect(renderCounts.a2).toBe(1);

    act(() => {
      useDesktopWindowStore.getState().moveWindow("a1", 200, 240);
    });

    expect(renderCounts.a1).toBe(2);
    expect(renderCounts.a2).toBe(1);
    expect(screen.getByTestId("agent-window-a1")).toHaveAttribute("data-x", "200");

    act(() => {
      useDesktopWindowStore.getState().resizeWindow("a1", 500, 620);
    });

    expect(renderCounts.a1).toBe(3);
    expect(renderCounts.a2).toBe(1);
    expect(screen.getByTestId("agent-window-a1")).toHaveAttribute("data-width", "500");
  });

  it("rerenders only the focus-affected windows when top window changes", () => {
    seedWindows();
    render(<DesktopWindowLayer />);

    expect(screen.getByTestId("agent-window-a2")).toHaveAttribute("data-focused", "true");

    act(() => {
      useDesktopWindowStore.getState().focusWindow("a1");
    });

    expect(renderCounts.a1).toBe(2);
    expect(renderCounts.a2).toBe(2);
    expect(screen.getByTestId("agent-window-a1")).toHaveAttribute("data-focused", "true");
    expect(screen.getByTestId("agent-window-a2")).toHaveAttribute("data-focused", "false");
  });
});
