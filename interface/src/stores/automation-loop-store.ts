import { create } from "zustand";

import type { ProjectId } from "../shared/types";

/**
 * Tracks the `agent_instance_id` the project's automation loop is
 * currently bound to, keyed by project. The AutomationBar populates
 * this from:
 *
 * 1. The `Loop`-role agent instance returned by `listAgentInstances`
 *    on first mount (so a previously-running loop is still
 *    controllable after a page reload), and
 * 2. The `agent_instance_id` returned by `startLoop` whenever the user
 *    starts the loop fresh.
 *
 * Subsequent pause/resume/stop calls scope themselves to that id so
 * concurrent ad-hoc task runs (which mint their own ephemeral
 * `Executor` instances) and the main chat thread (which lives on the
 * project's `Chat` instance) are never collateral damage when the
 * user hits Pause / Stop on the automation bar.
 *
 * The store is a project → id map rather than a single global slot so
 * the user can have one automation loop running per project at the
 * same time without the bound id flipping when they switch projects.
 *
 * On `LoopStopped` / `LoopFinished` for a bound loop the AutomationBar
 * clears the entry; the Loop-role `project_agents` row itself
 * survives so the next start reuses the same id.
 */
interface AutomationLoopState {
  /** projectId → bound loop `agent_instance_id`, or `null` if the
   *  project does not yet have a Loop instance allocated. */
  loopByProject: Record<string, string | null>;

  setLoopAgent: (projectId: ProjectId, agentInstanceId: string | null) => void;
  clearLoopAgent: (projectId: ProjectId) => void;
  getLoopAgent: (projectId: ProjectId) => string | null;
  reset: () => void;
}

export const useAutomationLoopStore = create<AutomationLoopState>((set, get) => ({
  loopByProject: {},
  setLoopAgent: (projectId, agentInstanceId) =>
    set((state) => ({
      loopByProject: { ...state.loopByProject, [projectId]: agentInstanceId },
    })),
  clearLoopAgent: (projectId) =>
    set((state) => {
      if (!(projectId in state.loopByProject)) return state;
      const next = { ...state.loopByProject };
      delete next[projectId];
      return { loopByProject: next };
    }),
  getLoopAgent: (projectId) => get().loopByProject[projectId] ?? null,
  reset: () => set({ loopByProject: {} }),
}));
