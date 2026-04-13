import { describe, it, expect, beforeEach, vi } from "vitest";

vi.stubGlobal("localStorage", {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
});

import { useTerminalPanelStore } from "./terminal-panel-store";
import type { UseTerminalReturn } from "../hooks/use-terminal";

beforeEach(() => {
  useTerminalPanelStore.setState({
    terminals: [],
    activeId: null,
    panelHeight: 260,
    collapsed: true,
    contentReady: false,
    cwd: undefined,
    remoteAgentId: undefined,
    modeReady: false,
    targetVersion: 0,
  });
});

describe("terminal-panel-store", () => {
  describe("initial state", () => {
    it("starts without terminals until a target is ready", () => {
      const state = useTerminalPanelStore.getState();
      expect(state.terminals).toHaveLength(0);
      expect(state.activeId).toBeNull();
    });

    it("starts collapsed", () => {
      expect(useTerminalPanelStore.getState().collapsed).toBe(true);
    });
  });

  describe("setTerminalTarget", () => {
    it("creates the first terminal and marks the target ready", () => {
      useTerminalPanelStore.getState().setTerminalTarget({ cwd: "/home/user" });

      const state = useTerminalPanelStore.getState();
      expect(state.cwd).toBe("/home/user");
      expect(state.modeReady).toBe(true);
      expect(state.targetVersion).toBe(1);
      expect(state.terminals).toHaveLength(1);
      expect(state.activeId).toBe(state.terminals[0]?.id ?? null);
    });

    it("preserves tabs and bumps the remount version when the target changes", () => {
      useTerminalPanelStore.getState().setTerminalTarget({ cwd: "/project/one" });
      useTerminalPanelStore.getState().addTerminal();

      const before = useTerminalPanelStore.getState();
      const beforeIds = before.terminals.map((terminal) => terminal.id);
      const beforeActiveId = before.activeId;
      const beforeVersion = before.targetVersion;

      useTerminalPanelStore.getState().setTerminalTarget({ cwd: "/project/two" });

      const after = useTerminalPanelStore.getState();
      expect(after.cwd).toBe("/project/two");
      expect(after.targetVersion).toBe(beforeVersion + 1);
      expect(after.terminals.map((terminal) => terminal.id)).toEqual(beforeIds);
      expect(after.activeId).toBe(beforeActiveId);
    });

    it("does not bump the remount version when the target is unchanged", () => {
      useTerminalPanelStore.getState().setTerminalTarget({ cwd: "/project/one" });

      const beforeVersion = useTerminalPanelStore.getState().targetVersion;

      useTerminalPanelStore.getState().setTerminalTarget({ cwd: "/project/one" });

      expect(useTerminalPanelStore.getState().targetVersion).toBe(beforeVersion);
    });

    it("updates the remote agent id as part of the same target change", () => {
      useTerminalPanelStore.getState().setTerminalTarget({
        cwd: "/project/one",
        remoteAgentId: "remote-1",
      });

      const state = useTerminalPanelStore.getState();
      expect(state.cwd).toBe("/project/one");
      expect(state.remoteAgentId).toBe("remote-1");
      expect(state.targetVersion).toBe(1);
    });

    it("keeps compatibility wrappers routed through the unified target setter", () => {
      useTerminalPanelStore.getState().setRemoteAgentId("remote-1");
      useTerminalPanelStore.getState().setCwd("/project/one");

      const state = useTerminalPanelStore.getState();
      expect(state.remoteAgentId).toBe("remote-1");
      expect(state.cwd).toBe("/project/one");
      expect(state.targetVersion).toBe(2);
      expect(state.terminals).toHaveLength(1);
    });
  });

  describe("addTerminal", () => {
    it("adds a new terminal and makes it active", () => {
      useTerminalPanelStore.getState().setTerminalTarget({ cwd: "/project/one" });
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
      useTerminalPanelStore.getState().setTerminalTarget({ cwd: "/project/one" });
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
      useTerminalPanelStore.getState().setTerminalTarget({ cwd: "/project/one" });
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
      useTerminalPanelStore.getState().setTerminalTarget({ cwd: "/project/one" });
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
