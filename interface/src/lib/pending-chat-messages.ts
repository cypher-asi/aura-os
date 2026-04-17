import type { DisplaySessionEvent } from "../types/stream";

const STORAGE_KEY = "aura:pending-chat-messages";
const MAX_PENDING_MESSAGES_PER_THREAD = 10;

type PendingChatState = Record<string, DisplaySessionEvent[]>;

function readState(): PendingChatState {
  if (typeof window === "undefined") {
    return {};
  }

  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as PendingChatState;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeState(state: PendingChatState): void {
  if (typeof window === "undefined") {
    return;
  }

  if (Object.keys(state).length === 0) {
    window.sessionStorage.removeItem(STORAGE_KEY);
    return;
  }

  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getPendingChatMessages(threadKey: string): DisplaySessionEvent[] {
  return readState()[threadKey] ?? [];
}

export function addPendingChatMessage(
  threadKey: string,
  message: DisplaySessionEvent,
): void {
  const state = readState();
  const previous = state[threadKey] ?? [];
  const next = [...previous.filter((entry) => entry.id !== message.id), message].slice(
    -MAX_PENDING_MESSAGES_PER_THREAD,
  );
  writeState({
    ...state,
    [threadKey]: next,
  });
}

export function clearPendingChatMessages(threadKey: string): void {
  const state = readState();
  if (!(threadKey in state)) {
    return;
  }
  const next = { ...state };
  delete next[threadKey];
  writeState(next);
}
