import { create } from "zustand";

/**
 * Project-scoped terminal command history. Each terminal tab is its own PTY
 * with its own shell-side history, so switching tabs (or reloading) normally
 * loses the commands you ran in another session. This store captures every
 * submitted command and groups it by a stable `key` (project id, falling back
 * to the remote agent id, then "local") so the history is shared across all
 * terminal tabs for a project and survives reloads via `localStorage` — the
 * same single-blob-keyed-by-project pattern used by `plan-store.ts`.
 *
 * Entries are stored newest-last.
 */

const STORAGE_KEY = "aura-terminal-history-by-key";
const MAX_ENTRIES = 1000;

function loadHistory(): Record<string, string[]> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function persist(historyByKey: Record<string, string[]>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(historyByKey));
  } catch {
    // localStorage may be unavailable (private mode / quota) — history simply
    // falls back to the in-memory copy for this session.
  }
}

interface TerminalHistoryState {
  historyByKey: Record<string, string[]>;
  /** Append a submitted command, ignoring blanks and consecutive duplicates. */
  pushCommand: (key: string, command: string) => void;
  /** Commands for `key`, oldest first / newest last. */
  getHistory: (key: string) => string[];
}

export const useTerminalHistoryStore = create<TerminalHistoryState>()((set, get) => ({
  historyByKey: loadHistory(),

  pushCommand: (key, command) => {
    const cmd = command.trim();
    if (!key || !cmd) return;
    set((s) => {
      const existing = s.historyByKey[key] ?? [];
      // Skip consecutive duplicates so holding Enter doesn't bloat history.
      if (existing[existing.length - 1] === cmd) return s;
      const next = [...existing, cmd];
      if (next.length > MAX_ENTRIES) {
        next.splice(0, next.length - MAX_ENTRIES);
      }
      const nextByKey = { ...s.historyByKey, [key]: next };
      persist(nextByKey);
      return { historyByKey: nextByKey };
    });
  },

  getHistory: (key) => get().historyByKey[key] ?? [],
}));
