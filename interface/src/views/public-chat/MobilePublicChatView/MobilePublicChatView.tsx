import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowUp } from "lucide-react";
import {
  isGuestAuthError,
  streamPublicChat,
  type PublicChatStreamHandle,
  type PublicChatTurn,
} from "../../../api/public-chat";
import {
  usePublicChatStore,
  type PublicMessage,
  type PublicSession,
} from "../../../stores/public-chat-store";
import { usePublicGateShown, usePublicPageViewed } from "../use-public-shell-analytics";
import { track } from "../../../lib/analytics";
import { PublicChatBubble } from "../PublicChatBubble";
import styles from "./MobilePublicChatView.module.css";

/**
 * Mobile-only public chat surface.
 *
 * Mounts at `/` and `/chat` when the layout is mobile and the
 * effective UI mode is `public`. Distinct from the desktop
 * `PublicChatView` — this surface intentionally drops the
 * decorative `MockAuraApp`, persona swap, persona tick rail, and
 * site-wallpaper system. On mobile the visitor lands on a single
 * "What do you want to create?" composer; once they submit, the
 * route flips to `/chat?session=<id>` and the same composer becomes
 * a sticky bottom input below a scrollable transcript.
 *
 * State sharing: backed by the same [`usePublicChatStore`] and the
 * same [`streamPublicChat`] SSE client as the desktop surface, so
 * sessions and history are continuous across resize / device
 * switches mid-session.
 */

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

const COMPOSER_PLACEHOLDER = "What do you want to create?";

export function MobilePublicChatView(): React.ReactElement {
  usePublicPageViewed();
  usePublicGateShown();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const activeSessionId = searchParams.get("session");
  const isChatPage = location.pathname === PUBLIC_CHAT_PATH;

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
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  const activeSession =
    activeSessionId != null ? sessions[activeSessionId] ?? null : null;

  // Note: `/chat` without a valid `?session=` deliberately does NOT
  // auto-mint a session here. Sessions are minted by `handleSubmit`
  // on first send (and on desktop by the sidebar `+` button). This
  // keeps the delete flow working — if the visitor deletes the only
  // session, they land back on `/chat` with an empty composer
  // rather than watching a fresh "New chat" spawn on top of the one
  // they just removed.

  useEffect(() => {
    return () => {
      streamRef.current?.close();
      streamRef.current = null;
    };
  }, []);

  // Keep the transcript pinned to the latest message as tokens stream
  // in. We scroll the inner `.transcript` container (not `window`) so
  // the topbar + composer stay fixed.
  useEffect(() => {
    const node = transcriptRef.current;
    if (node == null) return;
    node.scrollTop = node.scrollHeight;
  }, [activeSession?.turns.length, activeSession?.updatedAt]);

  const handleSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>): Promise<void> => {
      event.preventDefault();
      const message = draft.trim();
      if (!message || isSending) return;

      track("public_message_sent", { mode: "code" });

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

      // Open the SSE stream for this turn. On a guest-auth rejection
      // (stale token after a server-side secret rotation) we discard
      // the cached token, re-mint a fresh one, and retry the same turn
      // exactly once — `didRetry` guards against an infinite loop if
      // the freshly minted token is somehow rejected too.
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

  return (
    <div className={styles.root} data-testid="mobile-public-chat-view">
      {!isChatPage ? (
        <div className={styles.heroSlot}>
          <h1 className={styles.heroHeading}>{COMPOSER_PLACEHOLDER}</h1>
          <p className={styles.heroBlurb}>
            Send Aura a prompt and start building.
          </p>
        </div>
      ) : (
        <div
          ref={transcriptRef}
          className={styles.transcript}
          aria-live="polite"
          aria-label="Chat transcript"
          data-testid="mobile-public-chat-transcript"
        >
          {activeSession && activeSession.turns.length > 0 ? (
            activeSession.turns.map((message, idx) => {
              // Same in-flight detection as the desktop surface: the
              // last assistant message while `streamPublicChat` is
              // still appending deltas gets `isStreaming=true` so
              // `LLMOutput` runs in live-stream mode.
              const isLastAssistantTurn =
                isSending &&
                message.role === "assistant" &&
                idx === activeSession.turns.length - 1;
              return (
                <PublicChatBubble
                  key={message.id}
                  message={message}
                  isStreaming={isLastAssistantTurn}
                />
              );
            })
          ) : (
            <div className={styles.transcriptEmpty} aria-hidden="true">
              {COMPOSER_PLACEHOLDER}
            </div>
          )}
        </div>
      )}

      <form className={styles.composer} onSubmit={handleSubmit}>
        <label className={styles.composerLabel} htmlFor="mobile-public-chat-input">
          Message Aura
        </label>
        <input
          id="mobile-public-chat-input"
          className={styles.composerInput}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={COMPOSER_PLACEHOLDER}
          disabled={isSending}
          autoComplete="off"
          autoCorrect="on"
          spellCheck="true"
          enterKeyHint="send"
        />
        <button
          type="submit"
          className={styles.composerSend}
          disabled={isSending || draft.trim().length === 0}
          aria-label={isSending ? "Sending" : "Send"}
        >
          <ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" />
        </button>
        {sendError ? (
          <p className={styles.composerError} role="alert">
            {sendError}
          </p>
        ) : null}
      </form>
    </div>
  );
}
