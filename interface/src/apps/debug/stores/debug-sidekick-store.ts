import { create } from "zustand";
import type { DebugChannel } from "../../../shared/api/debug";
import {
  createSidekickSlice,
  persistActiveTab,
  type SidekickSliceState,
} from "../../../stores/shared/sidekick-slice";
import { DEBUG_SIDEKICK_ACTIVE_TAB_KEY } from "../../../constants";
import type { DebugLogEntry } from "../types";

/**
 * Tabs shown in the Debug sidekick taskbar. "Run" surfaces metadata,
 * counters, and run-level actions (copy JSONL, export). The remaining
 * tabs mirror the on-disk channels so switching tabs simply changes
 * which JSONL file we read via `useDebugRunLogs`.
 */
export type DebugSidekickTab =
  | "run"
  | "events"
  | "llm"
  | "iterations"
  | "blockers"
  | "retries"
  | "stats"
  | "tasks";

const DEBUG_SIDEKICK_TABS = new Set<DebugSidekickTab>([
  "run",
  "events",
  "llm",
  "iterations",
  "blockers",
  "retries",
  "stats",
  "tasks",
]);

function isDebugSidekickTab(value: string): value is DebugSidekickTab {
  return DEBUG_SIDEKICK_TABS.has(value as DebugSidekickTab);
}

/**
 * Map a sidekick tab to the on-disk channel the run detail view should
 * read. `run`, `stats`, and `tasks` aren't backed by a JSONL channel,
 * so callers keep showing the last non-channel selection.
 */
export function channelForTab(tab: DebugSidekickTab): DebugChannel | null {
  switch (tab) {
    case "events":
      return "events";
    case "llm":
      return "llm_calls";
    case "iterations":
      return "iterations";
    case "blockers":
      return "blockers";
    case "retries":
      return "retries";
    default:
      return null;
  }
}

interface DebugSidekickState
  extends SidekickSliceState<DebugSidekickTab, DebugLogEntry> {
  /** Currently inspected log entry. Drives the inspector panel. */
  selectedEntry: DebugLogEntry | null;
  /** Free-text filter applied to event rows. */
  textFilter: string;
  /** Event-type discriminator filter; empty string disables filtering. */
  typeFilter: string;

  selectEntry: (entry: DebugLogEntry | null) => void;
  setTextFilter: (value: string) => void;
  setTypeFilter: (value: string) => void;
  /**
   * Reset per-run state when navigating between runs so filters and a
   * stale selection from the previous run don't leak forward.
   */
  resetForRun: () => void;
}

export const useDebugSidekickStore = create<DebugSidekickState>()((set, get) => ({
  ...createSidekickSlice<DebugSidekickTab, DebugLogEntry>("run", set, get, {
    storageKey: DEBUG_SIDEKICK_ACTIVE_TAB_KEY,
    isValidTab: isDebugSidekickTab,
  }),
  // Overridden so the preview stack isn't cleared when flipping tabs,
  // matching how the Process sidekick keeps its preview open.
  setActiveTab: (tab: DebugSidekickTab) => {
    persistActiveTab(DEBUG_SIDEKICK_ACTIVE_TAB_KEY, tab);
    set({ activeTab: tab });
  },
  selectedEntry: null,
  textFilter: "",
  typeFilter: "",
  selectEntry: (entry) => set({ selectedEntry: entry }),
  setTextFilter: (value) => set({ textFilter: value }),
  setTypeFilter: (value) => set({ typeFilter: value }),
  resetForRun: () =>
    set({
      selectedEntry: null,
      textFilter: "",
      typeFilter: "",
    }),
}));
