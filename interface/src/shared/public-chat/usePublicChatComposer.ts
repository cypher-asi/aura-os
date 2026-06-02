import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  isGuestAuthError,
  streamPublicChat,
  type PublicChatStreamHandle,
  type PublicChatTurn,
} from "../../api/public-chat";
import {
  usePublicChatStore,
  type PublicMessage,
  type PublicSession,
} from "../../stores/public-chat-store";

const PUBLIC_CHAT_PATH = "/chat";

function publicChatRoute(sessionId: string): string {
  return `${PUBLIC_CHAT_PATH}?session=${encodeURIComponent(sessionId)}`;
}

function findReusableEmptySessionId(
  sessions: Record<string, PublicSession>,
  sessionOrder: readonly string[],
): string | null {
  return (
    sessionOrder.find((id) => {
      const session = sessions[id];
      return session != null && session.turns.length === 0;
    }) ?? null
  );
}

function toPublicChatHistory(turns: readonly PublicMessage[]): PublicChatTurn[] {
  return turns.flatMap((turn): PublicChatTurn[] => {
    if (turn.role === "user") {
      return [{ role: "user", content: turn.content }];
    }
    if (turn.mode === "code" || turn.mode === "plan") {
      return [{ role: "assistant", content: turn.content }];
    }
    return [];
  });
}

export function usePublicChatComposer() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeSessionId = searchParams.get("session");
  const sessions = usePublicChatStore((s) => s.sessions);
  const createSession = usePublicChatStore((s) => s.createSession);
  const ensureToken = usePublicChatStore((s) => s.ensureToken);
  const invalidateToken = usePublicChatStore((s) => s.invalidateToken);
  const appendUserTurn = usePublicChatStore((s) => s.appendUserTurn);
  const appendAssistantToken = usePublicChatStore((s) => s.appendAssistantToken);
  const commitAssistant = usePublicChatStore((s) => s.commitAssistant);
  const setTurnCount = usePublicChatStore((s) => s.setTurnCount);

  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const streamRef = useRef<PublicChatStreamHandle | null>(null);

  const activeSession =
    activeSessionId != null ? sessions[activeSessionId] ?? null : null;

  useEffect(() => {
    return () => {
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, []);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      const message = draft.trim();
      if (!message || isSending) return;

      const state = usePublicChatStore.getState();
      const targetSessionId =
        activeSessionId && state.sessions[activeSessionId]
          ? activeSessionId
          : findReusableEmptySessionId(state.sessions, state.sessionOrder) ??
            createSession();
      const history = toPublicChatHistory(
        state.sessions[targetSessionId]?.turns ?? [],
      );
      const assistantMessageId = `assistant-${Date.now().toString(36)}`;

      setDraft("");
      setSendError(null);
      setIsSending(true);
      navigate(publicChatRoute(targetSessionId), { replace: true });

      const launchStream = (token: string, didRetry: boolean): void => {
        streamRef.current = streamPublicChat({
          token,
          sessionId: targetSessionId,
          history,
          message,
          mode: "code",
          onDelta: (delta) => {
            appendAssistantToken(
              targetSessionId,
              assistantMessageId,
              delta,
              "code",
            );
          },
          onLimit: setTurnCount,
          onError: (err) => {
            if (!didRetry && isGuestAuthError(err)) {
              invalidateToken();
              ensureToken()
                .then((fresh) => launchStream(fresh, true))
                .catch((retryErr: unknown) => {
                  setSendError(
                    retryErr instanceof Error
                      ? retryErr.message
                      : "Unable to send message",
                  );
                  setIsSending(false);
                  streamRef.current = null;
                });
              return;
            }
            setSendError(err.message || "Unable to send message");
            setIsSending(false);
            streamRef.current = null;
          },
          onDone: () => {
            commitAssistant(targetSessionId, assistantMessageId);
            setIsSending(false);
            streamRef.current = null;
          },
        });
      };

      try {
        const token = await ensureToken();
        appendUserTurn(targetSessionId, message);
        launchStream(token, false);
      } catch (err) {
        setSendError(err instanceof Error ? err.message : "Unable to send message");
        setIsSending(false);
      }
    },
    [
      activeSessionId,
      appendAssistantToken,
      appendUserTurn,
      commitAssistant,
      createSession,
      draft,
      ensureToken,
      invalidateToken,
      isSending,
      navigate,
      setTurnCount,
    ],
  );

  return {
    activeSession,
    draft,
    handleSubmit,
    isSending,
    sendError,
    setDraft,
  };
}
