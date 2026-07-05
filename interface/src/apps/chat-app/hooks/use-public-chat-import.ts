import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "../../../api/client";
import { useSessionsListStore } from "../../../stores/sessions-list-store";
import type {
  PublicChatImportRequest,
  PublicChatImportResponse,
  PublicChatImportTurn,
} from "../../../shared/api/agents";
import type { Agent } from "../../../shared/types";
import type { PublicMessage, PublicSession } from "../../../stores/public-chat-store";

const PUBLIC_CHAT_STATE_KEY = "aura-public:state";
const PUBLIC_CHAT_IMPORTS_KEY = "aura-public:imports:v1";
const MAX_PENDING_IMPORT_SESSIONS = 10;
const IMPORT_RETRY_DELAY_MS = 30_000;

interface PersistedPublicChatState {
  sessions: Record<string, unknown>;
  sessionOrder: string[];
}

interface PublicChatImportsState {
  v: 1;
  imported: Record<
    string,
    {
      sessionId: string;
      importedAt: number;
    }
  >;
}

export type PendingPublicChatImport = PublicChatImportRequest;

function storageAvailable(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readPublicState(storage: Storage): PersistedPublicChatState | null {
  try {
    const raw = storage.getItem(PUBLIC_CHAT_STATE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || !isObject(parsed.sessions) || !Array.isArray(parsed.sessionOrder)) {
      return null;
    }
    return {
      sessions: parsed.sessions,
      sessionOrder: parsed.sessionOrder.filter((id): id is string => typeof id === "string"),
    };
  } catch {
    return null;
  }
}

function readImportsState(storage: Storage): PublicChatImportsState {
  try {
    const raw = storage.getItem(PUBLIC_CHAT_IMPORTS_KEY);
    if (!raw) return { v: 1, imported: {} };
    const parsed: unknown = JSON.parse(raw);
    if (!isObject(parsed) || parsed.v !== 1 || !isObject(parsed.imported)) {
      return { v: 1, imported: {} };
    }
    const imported: PublicChatImportsState["imported"] = {};
    for (const [publicSessionId, value] of Object.entries(parsed.imported)) {
      if (!isObject(value) || typeof value.sessionId !== "string") continue;
      imported[publicSessionId] = {
        sessionId: value.sessionId,
        importedAt: typeof value.importedAt === "number" ? value.importedAt : 0,
      };
    }
    return { v: 1, imported };
  } catch {
    return { v: 1, imported: {} };
  }
}

function writeImportsState(storage: Storage, state: PublicChatImportsState): void {
  try {
    storage.setItem(PUBLIC_CHAT_IMPORTS_KEY, JSON.stringify(state));
  } catch {
    // Private browsing / quota failures should not block the signed-in chat.
  }
}

function coercePublicSession(sessionId: string, raw: unknown): PublicSession | null {
  if (!isObject(raw)) return null;
  const id = typeof raw.id === "string" ? raw.id : sessionId;
  const title = typeof raw.title === "string" ? raw.title : "Imported public chat";
  const updatedAt = typeof raw.updatedAt === "number" ? raw.updatedAt : 0;
  if (!Array.isArray(raw.turns)) return null;
  const turns = raw.turns.flatMap(coercePublicMessage);
  if (turns.length === 0) return null;
  return { id, title, updatedAt, turns };
}

function coercePublicMessage(raw: unknown): PublicMessage[] {
  if (!isObject(raw) || typeof raw.id !== "string") return [];
  if (raw.role === "user" && typeof raw.content === "string") {
    return [{ id: raw.id, role: "user", content: raw.content }];
  }
  if (raw.role !== "assistant") return [];
  if (
    (raw.mode === "code" || raw.mode === "plan") &&
    typeof raw.content === "string"
  ) {
    return [{ id: raw.id, role: "assistant", mode: raw.mode, content: raw.content }];
  }
  if (
    (raw.mode === "image" || raw.mode === "video" || raw.mode === "model3d") &&
    typeof raw.url === "string" &&
    typeof raw.prompt === "string"
  ) {
    return [
      {
        id: raw.id,
        role: "assistant",
        mode: raw.mode,
        url: raw.url,
        prompt: raw.prompt,
      },
    ];
  }
  return [];
}

function turnToImportTurn(message: PublicMessage): PublicChatImportTurn | null {
  if (message.role === "user") {
    const content = message.content.trim();
    return content ? { role: "user", content } : null;
  }

  switch (message.mode) {
    case "code":
    case "plan": {
      const content = message.content.trim();
      return content ? { role: "assistant", content } : null;
    }
    case "image":
    case "video":
    case "model3d": {
      const label =
        message.mode === "image"
          ? "Generated image"
          : message.mode === "video"
            ? "Generated video"
            : "Generated 3D model";
      return {
        role: "assistant",
        content: `${label} for: ${message.prompt.trim()}\n\n${message.url}`,
      };
    }
  }
  return null;
}

export function readPendingPublicChatImports(
  storage: Storage | null = storageAvailable(),
): PendingPublicChatImport[] {
  if (!storage) return [];
  const publicState = readPublicState(storage);
  if (!publicState) return [];
  const importsState = readImportsState(storage);
  const orderedIds = publicState.sessionOrder.length
    ? publicState.sessionOrder
    : Object.keys(publicState.sessions).sort();

  const pendingNewestFirst = orderedIds
    .filter((id) => !importsState.imported[id])
    .map((id) => coercePublicSession(id, publicState.sessions[id]))
    .filter((session): session is PublicSession => session !== null)
    .map((session): PendingPublicChatImport | null => {
      const turns = session.turns
        .map(turnToImportTurn)
        .filter((turn): turn is PublicChatImportTurn => turn !== null);
      if (turns.length === 0) return null;
      return {
        publicSessionId: session.id,
        title: session.title,
        turns,
      };
    })
    .filter((session): session is PendingPublicChatImport => session !== null)
    .slice(0, MAX_PENDING_IMPORT_SESSIONS);

  return pendingNewestFirst.reverse();
}

export function markPublicChatImported(
  publicSessionId: string,
  response: Pick<PublicChatImportResponse, "sessionId">,
  storage: Storage | null = storageAvailable(),
): void {
  if (!storage) return;
  const importsState = readImportsState(storage);
  importsState.imported[publicSessionId] = {
    sessionId: response.sessionId,
    importedAt: Date.now(),
  };
  writeImportsState(storage, importsState);
}

export function useImportPublicChatsOnAuth(agent: Agent | null): void {
  const navigate = useNavigate();
  const location = useLocation();
  const ranRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const agentId = agent?.agent_id ?? null;

  useEffect(
    () => () => {
      if (retryTimerRef.current !== null) {
        window.clearTimeout(retryTimerRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!agentId || ranRef.current) return;
    ranRef.current = true;

    const scheduleRetry = () => {
      if (typeof window === "undefined" || retryTimerRef.current !== null) return;
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        ranRef.current = false;
        setRetryAttempt((attempt) => attempt + 1);
      }, IMPORT_RETRY_DELAY_MS);
    };

    void (async () => {
      const pending = readPendingPublicChatImports();
      if (pending.length === 0) return;

      let newestImported: PublicChatImportResponse | null = null;
      let failedImportCount = 0;
      for (const session of pending) {
        try {
          const response = await api.superAgent.importPublicSession(
            agentId,
            session,
          );
          markPublicChatImported(session.publicSessionId, response);
          newestImported = response;
        } catch (error) {
          failedImportCount += 1;
          console.warn("[chat-app] public chat import failed", {
            publicSessionId: session.publicSessionId,
            error,
          });
        }
      }

      if (failedImportCount > 0) {
        scheduleRetry();
      }

      if (!newestImported) return;
      const store = useSessionsListStore.getState();
      store.bumpVersion();
      void store.loadUserSessions();

      const currentParams = new URLSearchParams(location.search);
      if (currentParams.has("session")) return;

      const params = new URLSearchParams({
        agent: newestImported.agentId,
        project: newestImported.projectId,
        instance: newestImported.agentInstanceId,
        session: newestImported.sessionId,
      });
      navigate(`/chat?${params.toString()}`, { replace: true });
    })();
  }, [agentId, location.search, navigate, retryAttempt]);
}

export const __publicChatImportTestKeys = {
  PUBLIC_CHAT_STATE_KEY,
  PUBLIC_CHAT_IMPORTS_KEY,
};
