import { describe, it, expect, beforeEach, vi } from "vitest";

vi.stubGlobal("localStorage", {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
});

import { useTerminalPanelStore } from "./terminal-panel-store";
import type { UseTerminalReturn } from "../hooks/use-terminal";

beforeEach(() => {
  const s = useTerminalPanelStore.getState();
  useTerminalPanelStore.setState({
    terminals: s.terminals.slice(0, 1),
    activeId: s.terminals[0]?.id ?? null,
    panelHeight: 260,
    collapsed: true,
    contentReady: false,
    cwd: undefined,
  });
});

describe("terminal-panel-store", () => {
  describe("initial state", () => {
    it("has one terminal by default", () => {
      expect(useTerminalPanelStore.getState().terminals).toHaveLength(1);
    });

    it("has an activeId matching the first terminal", () => {
      const { terminals, activeId } = useTerminalPanelStore.getState();
      expect(activeId).toBe(terminals[0].id);
    });

    it("starts collapsed", () => {
      expect(useTerminalPanelStore.getState().collapsed).toBe(true);
    });
  });

  describe("setCwd", () => {
    it("sets the working directory", () => {
      useTerminalPanelStore.getState().setCwd("/home/user");
      expect(useTerminalPanelStore.getState().cwd).toBe("/home/user");
    });
  });

  describe("addTerminal", () => {
    it("adds a new terminal and makes it active", () => {
      useTerminalPanelStore.getState().addTerminal();
      const { terminals, activeId } = useTerminalPanelStore.getState();
      expect(terminals.length).toBeGreaterThanOrEqual(2);
      expect(activeId).toBe(terminals[terminals.length - 1].id);
    });

    it("uncollapse the panel", () => {
      useTerminalPanelStore.setState({ collapsed: true });
      useTerminalPanelStore.getState().addTerminal();
      expect(useTerminalPanelStore.getState().collapsed).toBe(false);
    });
  });

  describe("removeTerminal", () => {
    it("removes a terminal and selects the last remaining", () => {
      useTerminalPanelStore.getState().addTerminal();
      const { terminals } = useTerminalPanelStore.getState();
      const idToRemove = terminals[0].id;
      useTerminalPanelStore.getState().removeTerminal(idToRemove);

      const after = useTerminalPanelStore.getState();
      expect(after.terminals.find((t) => t.id === idToRemove)).toBeUndefined();
      expect(after.activeId).toBe(after.terminals[after.terminals.length - 1]?.id ?? null);
    });
  });

  describe("registerHook", () => {
    it("registers a hook on a terminal", () => {
      const { terminals } = useTerminalPanelStore.getState();
      const id = terminals[0].id;
      const hook = { kill: vi.fn() } as unknown as UseTerminalReturn;

      useTerminalPanelStore.getState().registerHook(id, hook);

      const updated = useTerminalPanelStore.getState().terminals.find((t) => t.id === id);
      expect(updated?.hook).toBe(hook);
    });
  });

  describe("setActiveId", () => {
    it("changes the active terminal", () => {
      useTerminalPanelStore.getState().addTerminal();
      const { terminals } = useTerminalPanelStore.getState();
      useTerminalPanelStore.getState().setActiveId(terminals[0].id);
      expect(useTerminalPanelStore.getState().activeId).toBe(terminals[0].id);
    });
  });

  describe("toggleCollapse", () => {
    it("toggles collapsed state", () => {
      expect(useTerminalPanelStore.getState().collapsed).toBe(true);
      useTerminalPanelStore.getState().toggleCollapse();
      expect(useTerminalPanelStore.getState().collapsed).toBe(false);
    });
  });
});
