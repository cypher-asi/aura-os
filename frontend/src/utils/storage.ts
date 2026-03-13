import { LAST_CHAT_KEY } from "../constants";

export function getLastChat(): { projectId: string; chatSessionId: string } | null {
  try {
    const raw = localStorage.getItem(LAST_CHAT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.projectId && parsed?.chatSessionId) return parsed;
  } catch {
    // ignore malformed data
  }
  return null;
}

export function setLastChat(projectId: string, chatSessionId: string): void {
  localStorage.setItem(LAST_CHAT_KEY, JSON.stringify({ projectId, chatSessionId }));
}

export function clearLastChatIf(match: { projectId?: string; chatSessionId?: string }): void {
  try {
    const last = JSON.parse(localStorage.getItem(LAST_CHAT_KEY) || "{}");
    if (
      (match.projectId && last.projectId === match.projectId) ||
      (match.chatSessionId && last.chatSessionId === match.chatSessionId)
    ) {
      localStorage.removeItem(LAST_CHAT_KEY);
    }
  } catch {
    // ignore
  }
}
