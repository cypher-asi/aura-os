import { getStoredSession } from "./auth-token";
import { getResolvedHostOrigin } from "./host-config";

/** Device-local metadata only: never transcript text. Cleared on logout. */
export interface ChatReadingPosition {
  rowId: string;
  offsetWithinRow: number;
  scrollOffset: number;
  atEnd: boolean;
}

const positions = new Map<string, ChatReadingPosition>();
const MAX_POSITIONS = 100;
const STORAGE_KEY = "aura-chat-reading-positions-v1";
const MAX_STORAGE_BYTES = 128 * 1024;
let activeOwner: string | null | undefined;
let pendingSave: ReturnType<typeof setTimeout> | undefined;

function currentOwner(): string | null {
  try {
    const userId = getStoredSession()?.user_id;
    const host = userId ? getResolvedHostOrigin() : "";
    return userId && host ? JSON.stringify([host, userId]) : null;
  } catch { return null; }
}

function validPosition(value: unknown): value is ChatReadingPosition {
  if (!value || typeof value !== "object") return false;
  const p = value as Partial<ChatReadingPosition>;
  return typeof p.rowId === "string" && p.rowId.length > 0 && p.rowId.length <= 256
    && typeof p.atEnd === "boolean"
    && [p.offsetWithinRow, p.scrollOffset].every((n) => typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 100_000_000)
    && p.scrollOffset! >= 0;
}

function ensureOwner(): void {
  const owner = currentOwner();
  if (owner === activeOwner) return;
  if (pendingSave !== undefined) clearTimeout(pendingSave);
  pendingSave = undefined;
  positions.clear();
  activeOwner = owner;
  if (!owner || typeof window === "undefined") return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw || raw.length > MAX_STORAGE_BYTES) return;
    const record = JSON.parse(raw);
    if (record?.version !== 1 || record.owner !== owner || !Array.isArray(record.positions)) return;
    for (const entry of record.positions.slice(-MAX_POSITIONS)) {
      if (Array.isArray(entry) && typeof entry[0] === "string" && entry[0].length <= 1024 && validPosition(entry[1])) {
        positions.set(entry[0], { ...entry[1] });
      }
    }
  } catch { /* Corrupt or unavailable storage must not prevent opening a chat. */ }
}

function flush(): void {
  if (pendingSave !== undefined) clearTimeout(pendingSave);
  pendingSave = undefined;
  if (!activeOwner || currentOwner() !== activeOwner || typeof window === "undefined") return;
  try {
    const entries = [...positions];
    let value = JSON.stringify({ version: 1, owner: activeOwner, positions: entries });
    while (value.length > MAX_STORAGE_BYTES && entries.length) {
      entries.shift();
      value = JSON.stringify({ version: 1, owner: activeOwner, positions: entries });
    }
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch { /* Quota/privacy-mode failures retain the in-memory fallback. */ }
}

function scheduleSave(): void {
  // Do not synchronously serialize on every wheel/touch event. Flush on a
  // bounded cadence as well as background/close, rather than waiting forever
  // for an actively scrolling user to become idle.
  if (pendingSave === undefined && activeOwner) pendingSave = setTimeout(flush, 250);
}

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

export function readChatPosition(key?: string): ChatReadingPosition | undefined {
  ensureOwner();
  const position = key ? positions.get(key) : undefined;
  return position ? { ...position } : undefined;
}

export function rememberChatPosition(key: string, position: ChatReadingPosition): void {
  ensureOwner();
  if (!key || key.length > 1024 || !validPosition(position)) return;
  positions.delete(key);
  positions.set(key, { ...position });
  if (positions.size > MAX_POSITIONS) positions.delete(positions.keys().next().value!);
  scheduleSave();
}

export function followChatPosition(key?: string): void {
  const position = readChatPosition(key);
  if (key && position) rememberChatPosition(key, { ...position, atEnd: true });
}

export function clearChatPositions(): void {
  if (pendingSave !== undefined) clearTimeout(pendingSave);
  pendingSave = undefined;
  positions.clear();
  activeOwner = undefined;
  try { window.localStorage.removeItem(STORAGE_KEY); } catch { /* Storage may be disabled. */ }
}
