import {
  useEffect,
  useRef,
} from "react";
import { useLocation } from "react-router-dom";
import { ArrowUp } from "lucide-react";
import { usePublicChatComposer } from "../../../shared/public-chat/usePublicChatComposer";
import { PublicChatBubble } from "../../../views/public-chat/PublicChatBubble";
import {
  usePublicGateShown,
  usePublicPageViewed,
} from "../../../views/public-chat/use-public-shell-analytics";
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

const COMPOSER_PLACEHOLDER = "What do you want to create?";

export function MobilePublicChatView(): React.ReactElement {
  usePublicPageViewed();
  usePublicGateShown();

  const location = useLocation();
  const isChatPage = location.pathname === PUBLIC_CHAT_PATH;
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const {
    activeSession,
    draft,
    handleSubmit,
    isSending,
    sendError,
    setDraft,
  } = usePublicChatComposer();

  // Note: `/chat` without a valid `?session=` deliberately does NOT
  // auto-mint a session here. Sessions are minted by `handleSubmit`
  // on first send (and on desktop by the sidebar `+` button). This
  // keeps the delete flow working — if the visitor deletes the only
  // session, they land back on `/chat` with an empty composer
  // rather than watching a fresh "New chat" spawn on top of the one
  // they just removed.

  // Keep the transcript pinned to the latest message as tokens stream
  // in. We scroll the inner `.transcript` container (not `window`) so
  // the topbar + composer stay fixed.
  useEffect(() => {
    const node = transcriptRef.current;
    if (node == null) return;
    node.scrollTop = node.scrollHeight;
  }, [activeSession?.turns.length, activeSession?.updatedAt]);

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
