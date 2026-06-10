/**
 * Zustand store powering the logged-out chat surface.
 *
 * The whole transcript lives in `localStorage["aura-public:state"]`
 * — the server never persists guest messages. The schema is
 * versioned (`SCHEMA_VERSION`) so future field changes can migrate
 * cleanly rather than blowing away every visitor's history on
 * deploy.
 *
 * The 3-turn gate is derived from `turnCount`; the modal can never
 * be dismissed so no separate "show" / "dismissed" latch is needed.
 */

import { create } from "zustand";
import { setupPublicSession } from "../api/public-chat";
import { track } from "../lib/analytics";

/** Modality. Code + Plan ship in Phase 2; image / video / model3d
 *  joined in Phase 3 (this file's current state) so the discriminated
 *  union below is closed over the full surface. */
export type PublicMode = "code" | "plan" | "image" | "video" | "model3d";

/** Asset-bearing assistant message produced by the three generation
 *  modalities. Pulled out as a named alias because `commitMedia()` 's
 *  signature is the single most copy-pasted public-mode shape. */
export type PublicAssistantMediaMessage = {
  id: string;
  role: "assistant";
  mode: "image" | "video" | "model3d";
  url: string;
  prompt: string;
};

/** One discriminated-union message in a public transcript. The `user`
 *  variant carries free-text input from the visitor; `assistant`
 *  variants split on `mode`: chat modalities (`code`, `plan`) carry
 *  rendered markdown via `content`, media modalities (`image`,
 *  `video`, `model3d`) carry a hosted asset `url` plus the original
 *  prompt for re-display. */
export type PublicMessage =
  | { id: string; role: "user"; content: string }
  | { id: string; role: "assistant"; mode: "code" | "plan"; content: string }
  | PublicAssistantMediaMessage;

/** One client-side public session. */
export interface PublicSession {
  id: string;
  title: string;
  updatedAt: number;
  turns: PublicMessage[];
}

interface PublicChatState {
  guestToken: string | null;
  limit: number;
  turnCount: number;
  sessions: Record<string, PublicSession>;
  /** Newest-first order. */
  sessionOrder: string[];
  hasHydrated: boolean;
  /** True while a `setupPublicSession()` round-trip is in flight; we
   *  use this to make `ensureToken()` idempotent under concurrent
   *  mount calls. */
  setupInFlight: boolean;
}

interface PublicChatActions {
  ensureToken: () => Promise<string>;
  /** Clear the cached guest token so the next `ensureToken()` call
   *  mints a fresh one. Called when the server rejects a token
   *  ("invalid guest token") so the user isn't permanently stuck. */
  invalidateToken: () => void;
  createSession: () => string;
  deleteSession: (sessionId: string) => void;
  appendUserTurn: (sessionId: string, content: string) => string;
  appendAssistantToken: (
    sessionId: string,
    messageId: string,
    deltaText: string,
    mode: "code" | "plan",
  ) => void;
  commitAssistant: (sessionId: string, messageId: string) => void;
  commitMedia: (sessionId: string, message: PublicAssistantMediaMessage) => void;
  setTurnCount: (next: number) => void;
}

type PublicChatStore = PublicChatState & PublicChatActions;

const STORAGE_KEY = "aura-public:state";
/** Persisted-shape schema version. Phase 2 wrote v1 with chat-only
 *  assistant messages (no `mode` discriminator). Phase 3 introduces v2,
 *  whose assistant messages carry an explicit `mode` field. The reader
 *  forward-migrates v1 → v2 in-memory so existing visitors do not lose
 *  their transcript across the upgrade. */
const SCHEMA_VERSION = 2;
const DEFAULT_LIMIT = 3;

interface PersistedShape {
  v: 1 | 2;
  guestToken: string | null;
  limit: number;
  turnCount: number;
  sessions: Record<string, unknown>;
  sessionOrder: string[];
}

function loadPersisted(): Partial<PublicChatState> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedShape(parsed)) return {};
    const sessions = migrateSessions(parsed.sessions);
    return {
      guestToken: parsed.guestToken,
      limit: parsed.limit,
      turnCount: parsed.turnCount,
      sessions,
      sessionOrder: parsed.sessionOrder.filter((id) => id in sessions),
    };
  } catch {
    return {};
  }
}

function persist(state: PublicChatState): void {
  if (typeof window === "undefined") return;
  const payload: PersistedShape = {
    v: SCHEMA_VERSION,
    guestToken: state.guestToken,
    limit: state.limit,
    turnCount: state.turnCount,
    sessions: state.sessions,
    sessionOrder: state.sessionOrder,
  };
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Quota / private mode — drop silently. The store stays usable
    // in-memory, the transcript just won't survive a reload.
  }
}

function isPersistedShape(value: unknown): value is PersistedShape {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    (v.v === 1 || v.v === 2) &&
    (v.guestToken === null || typeof v.guestToken === "string") &&
    typeof v.limit === "number" &&
    typeof v.turnCount === "number" &&
    typeof v.sessions === "object" &&
    v.sessions !== null &&
    Array.isArray(v.sessionOrder)
  );
}

/**
 * Convert a persisted sessions map (v1 or v2) into the live in-memory
 * shape. Drops any message that cannot be coerced into a valid
 * [`PublicMessage`] variant so a corrupt entry never breaks the
 * transcript view. v1 assistant rows lack a `mode` discriminator —
 * Phase 2 hardcoded `mode: "code"` per the subagent report — and are
 * remapped onto the chat variant; assistant rows whose `mode` is
 * unrecognised are dropped.
 */
function migrateSessions(
  raw: Record<string, unknown>,
): Record<string, PublicSession> {
  const out: Record<string, PublicSession> = {};
  for (const [sessionId, rawSession] of Object.entries(raw)) {
    if (!isObject(rawSession)) continue;
    const id = typeof rawSession.id === "string" ? rawSession.id : sessionId;
    const title =
      typeof rawSession.title === "string" ? rawSession.title : newChatTitle();
    const updatedAt =
      typeof rawSession.updatedAt === "number" ? rawSession.updatedAt : Date.now();
    const turns: PublicMessage[] = Array.isArray(rawSession.turns)
      ? rawSession.turns.flatMap(coerceMessage)
      : [];
    out[id] = { id, title, updatedAt, turns };
  }
  return out;
}

function coerceMessage(raw: unknown): PublicMessage[] {
  if (!isObject(raw)) return [];
  const id = typeof raw.id === "string" ? raw.id : null;
  if (!id) return [];
  if (raw.role === "user" && typeof raw.content === "string") {
    return [{ id, role: "user", content: raw.content }];
  }
  if (raw.role !== "assistant") return [];
  const mode = raw.mode;
  if ((mode === "code" || mode === "plan") && typeof raw.content === "string") {
    return [{ id, role: "assistant", mode, content: raw.content }];
  }
  if (
    (mode === "image" || mode === "video" || mode === "model3d") &&
    typeof raw.url === "string" &&
    typeof raw.prompt === "string"
  ) {
    return [{ id, role: "assistant", mode, url: raw.url, prompt: raw.prompt }];
  }
  // v1 fallthrough: persisted assistant message without a `mode`
  // discriminator. The Phase 2 store hardcoded the chat variant, so
  // we forward-migrate to the same shape.
  if (typeof raw.content === "string" && mode === undefined) {
    return [{ id, role: "assistant", mode: "code", content: raw.content }];
  }
  return [];
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function randomId(prefix: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}-${rand}`;
}

const initialPersisted = loadPersisted();

const initialState: PublicChatState = {
  guestToken: initialPersisted.guestToken ?? null,
  limit: initialPersisted.limit ?? DEFAULT_LIMIT,
  turnCount: initialPersisted.turnCount ?? 0,
  sessions: initialPersisted.sessions ?? {},
  sessionOrder: initialPersisted.sessionOrder ?? [],
  hasHydrated: true,
  setupInFlight: false,
};

function persistFromGet(get: () => PublicChatStore): void {
  persist(get());
}

export const usePublicChatStore = create<PublicChatStore>((set, get) => ({
  ...initialState,
  ensureToken: async () => {
    const existing = get().guestToken;
    if (existing) return existing;
    if (get().setupInFlight) {
      // Spin-wait briefly for the in-flight setup to settle. Simpler
      // than juggling a shared promise reference and covers the only
      // realistic race (two component effects firing in the same
      // commit phase).
      for (let i = 0; i < 50; i += 1) {
        await new Promise((r) => setTimeout(r, 20));
        const tok = get().guestToken;
        if (tok) return tok;
      }
    }
    set({ setupInFlight: true });
    try {
      const response = await setupPublicSession();
      set({
        guestToken: response.token,
        turnCount: response.turn_count,
        limit: response.limit,
      });
      persistFromGet(get);
      track("public_session_started");
      return response.token;
    } finally {
      set({ setupInFlight: false });
    }
  },
  invalidateToken: () => {
    set({ guestToken: null });
    persistFromGet(get);
  },
  createSession: () => {
    const id = randomId("public");
    const session: PublicSession = {
      id,
      title: newChatTitle(),
      updatedAt: Date.now(),
      turns: [],
    };
    set((s) => ({
      sessions: { ...s.sessions, [id]: session },
      sessionOrder: [id, ...s.sessionOrder.filter((existing) => existing !== id)],
    }));
    persistFromGet(get);
    return id;
  },
  deleteSession: (sessionId) => {
    set((s) => {
      const nextSessions = { ...s.sessions };
      delete nextSessions[sessionId];
      return {
        sessions: nextSessions,
        sessionOrder: s.sessionOrder.filter((id) => id !== sessionId),
      };
    });
    persistFromGet(get);
  },
  appendUserTurn: (sessionId, content) => {
    const messageId = randomId("user");
    set((s) => {
      const existing = s.sessions[sessionId];
      const sessionExists = !!existing;
      const session: PublicSession = existing ?? {
        id: sessionId,
        title: newChatTitle(),
        updatedAt: Date.now(),
        turns: [],
      };
      const turns: PublicMessage[] = [
        ...session.turns,
        { id: messageId, role: "user", content },
      ];
      const title =
        session.turns.length === 0 ? deriveTitle(content) : session.title;
      const nextSession: PublicSession = {
        ...session,
        turns,
        title,
        updatedAt: Date.now(),
      };
      const nextOrder = sessionExists
        ? [sessionId, ...s.sessionOrder.filter((id) => id !== sessionId)]
        : [sessionId, ...s.sessionOrder];
      return {
        sessions: { ...s.sessions, [sessionId]: nextSession },
        sessionOrder: nextOrder,
      };
    });
    persistFromGet(get);
    return messageId;
  },
  // TODO(thinking): the public-chat SSE protocol currently emits only
  // `text_delta` / `limit` / `error` frames (see
  // `interface/src/api/public-chat.ts::dispatchPublicSseFrame`).
  // Surfacing the standard Brain "Thinking..." Block on public-chat
  // assistant turns — the Phase 1 synthetic placeholder in
  // `ActivityTimeline` already does the rest as soon as a real
  // `thinking_delta` event lands in the timeline — requires:
  //   (a) the public-chat backend to forward `thinking_delta` (and
  //       optionally tool-call events) over the same SSE stream, and
  //   (b) a new `appendAssistantThinking(...)` reducer here that
  //       populates a per-message `thinkingText` / `timeline` field,
  //       plumbed through `PublicChatBubble` into `LLMOutput`'s
  //       `thinkingText` / `timeline` props.
  // Out of scope for the Phase 3 bubble-replacement; see
  // `plans/thinking_block_audit.md` Section E for the full plan.
  appendAssistantToken: (sessionId, messageId, deltaText, mode) => {
    set((s) => {
      const existing = s.sessions[sessionId];
      if (!existing) return s;
      const turns: PublicMessage[] = [...existing.turns];
      const last = turns[turns.length - 1];
      if (
        last &&
        last.role === "assistant" &&
        (last.mode === "code" || last.mode === "plan") &&
        last.id === messageId
      ) {
        turns[turns.length - 1] = { ...last, content: last.content + deltaText };
      } else {
        turns.push({
          id: messageId,
          role: "assistant",
          mode,
          content: deltaText,
        });
      }
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...existing, turns, updatedAt: Date.now() },
        },
      };
    });
    // Don't persist on every delta — too noisy. We persist on commit.
  },
  commitAssistant: (sessionId) => {
    set((s) => {
      const existing = s.sessions[sessionId];
      if (!existing) return s;
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...existing, updatedAt: Date.now() },
        },
      };
    });
    persistFromGet(get);
  },
  commitMedia: (sessionId, message) => {
    set((s) => {
      const existing = s.sessions[sessionId];
      if (!existing) return s;
      const turns: PublicMessage[] = [...existing.turns, message];
      return {
        sessions: {
          ...s.sessions,
          [sessionId]: { ...existing, turns, updatedAt: Date.now() },
        },
      };
    });
    persistFromGet(get);
  },
  setTurnCount: (next) => {
    set({ turnCount: Math.max(0, Math.floor(next)) });
    persistFromGet(get);
  },
}));

/**
 * Derived gate selector. Returns `true` once the server-authoritative
 * `turnCount` has hit the limit — drives the `KeepChattingModal`
 * mount and the disabled state on the input bar.
 */
export function selectShouldShowGate(state: PublicChatStore): boolean {
  return state.turnCount >= state.limit;
}

/**
 * Pull the (optionally undefined) session for a given id without
 * forcing every consumer to re-derive the same lookup. Returns
 * `null` for unknown ids so callers can branch cleanly.
 */
export function selectSession(
  state: PublicChatStore,
  sessionId: string,
): PublicSession | null {
  return state.sessions[sessionId] ?? null;
}

function deriveTitle(content: string): string {
  const trimmed = content.trim();
  if (!trimmed) return newChatTitle();
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
}

function newChatTitle(): string {
  return "New chat";
}
