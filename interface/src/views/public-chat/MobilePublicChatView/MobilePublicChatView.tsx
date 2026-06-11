import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
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
import { MobileLandingHero } from "../MobileLandingHero";
import { PERSONAS } from "../personas";
import styles from "./MobilePublicChatView.module.css";

/**
 * Mobile-only public chat surface.
 *
 * Mounts at `/` and `/chat` when the layout is mobile and the
 * effective UI mode is `public`. Distinct from the desktop
 * `PublicChatView` — this surface intentionally drops the heavy
 * decorative machinery (`MockAuraApp`, persona swap carousel,
 * persona tick rail, WebGL site backgrounds). The landing route
 * mirrors the desktop story in a lighter form: a Creator-pinned
 * `MobileLandingHero` (typewriter tagline, static portrait, composer,
 * CTA) that scrolls into the same lazily-embedded `/agents` section
 * stack. Once the visitor submits the composer, the route flips to
 * `/chat?session=<id>` and the composer becomes a sticky bottom
 * input below a scrollable transcript.
 *
 * State sharing: backed by the same [`usePublicChatStore`] and the
 * same [`streamPublicChat`] SSE client as the desktop surface, so
 * sessions and history are continuous across resize / device
 * switches mid-session.
 */

/*
 * Same lazy `/agents` embed as the desktop landing (`PublicChatView`):
 * the section stack is heavy (WebGL scenes, videos, a changelog
 * fetch), so it stays out of the landing page's first paint and
 * mounts on the visitor's first interaction — or once the main
 * thread goes idle.
 */
const AgentsPageSections = lazy(
  () => import("../../marketing/ProductView/AgentsPageSections"),
);

/*
 * Same WebGL page backgrounds the desktop landing pins behind its
 * scroll column (`PublicChatView`). On mobile we pin them behind the
 * Creator hero too, so scrolling the hero reveals the live plasma and
 * the opaque agents sections slide up over it. Lazy so the three.js
 * vendor chunk stays off the landing page's critical path; the
 * persona's solid `siteBackgroundColor` paints while it loads.
 */
const ScreenOrbBackground = lazy(() =>
  import("../PublicChatView/ScreenOrbBackground").then((m) => ({
    default: m.ScreenOrbBackground,
  })),
);
const FlowFieldBackground = lazy(() =>
  import("../PublicChatView/FlowFieldBackground").then((m) => ({
    default: m.FlowFieldBackground,
  })),
);

// The Creator — `PERSONAS[0]`, the same default persona the desktop
// carousel opens on — is the ONLY persona the mobile landing shows
// before the visitor scrolls into the agents flow.
const CREATOR_PERSONA = PERSONAS[0];

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
  const { t } = useTranslation("publicChat");
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

  // Whether the embedded `/agents` section stack should mount below
  // the hero. Same deferral contract as the desktop landing: first
  // interaction (touch/wheel/key/pointer — i.e. before any scroll
  // into it can happen) or main-thread idle, whichever comes first,
  // keeps the heavy chunk off the landing page's first paint.
  const [agentsEmbedReady, setAgentsEmbedReady] = useState(false);
  useEffect(() => {
    if (isChatPage || agentsEmbedReady) return;
    let idleId: number | null = null;
    const ready = (): void => setAgentsEmbedReady(true);
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    for (const name of events) {
      window.addEventListener(name, ready, { passive: true, once: true });
    }
    // Safari still lacks requestIdleCallback; fall back to a timeout.
    const hasIdleCallback = typeof window.requestIdleCallback === "function";
    if (hasIdleCallback) {
      idleId = window.requestIdleCallback(ready, { timeout: 2_500 });
    } else {
      idleId = window.setTimeout(ready, 2_500);
    }
    return () => {
      for (const name of events) {
        window.removeEventListener(name, ready);
      }
      if (idleId !== null) {
        if (hasIdleCallback) window.cancelIdleCallback(idleId);
        else window.clearTimeout(idleId);
      }
    };
  }, [isChatPage, agentsEmbedReady]);

  const activeSession =
    activeSessionId != null ? sessions[activeSessionId] ?? null : null;
  const composerPlaceholder = t("mobileChat.composerPlaceholder", {
    defaultValue: COMPOSER_PLACEHOLDER,
  });
  const unableToSendMessage = t("chat.errors.unableToSend", {
    defaultValue: "Unable to send message",
  });

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
                      : unableToSendMessage,
                  );
                  setIsSending(false);
                  streamRef.current = null;
                });
              return;
            }
            setSendError(err.message || unableToSendMessage);
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
        setSendError(err instanceof Error ? err.message : unableToSendMessage);
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
      unableToSendMessage,
    ],
  );

  // One composer instance, placed differently per mode: centered
  // inside the hero on the landing route, sticky bottom bar on
  // `/chat`. Hoisted so both placements share the exact same form.
  const composerForm = (
    <form
      className={
        isChatPage ? styles.composer : `${styles.composer} ${styles.composerHero}`
      }
      onSubmit={handleSubmit}
    >
      <label className={styles.composerLabel} htmlFor="mobile-public-chat-input">
        {t("chat.inputLabel", { defaultValue: "Message Aura" })}
      </label>
      <input
        id="mobile-public-chat-input"
        className={styles.composerInput}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder={composerPlaceholder}
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
        aria-label={
          isSending
            ? t("chat.sending", { defaultValue: "Sending" })
            : t("chat.send", { defaultValue: "Send" })
        }
      >
        <ArrowUp size={18} strokeWidth={2.4} aria-hidden="true" />
      </button>
      {sendError ? (
        <p className={styles.composerError} role="alert">
          {sendError}
        </p>
      ) : null}
    </form>
  );

  return (
    <div className={styles.root} data-testid="mobile-public-chat-view">
      {!isChatPage ? (
        /*
         * Landing scroll column — Creator hero viewport first, the
         * embedded `/agents` section stack below it. Scrolling past
         * the hero moves straight into the agents story without a
         * route change, mirroring the desktop landing. The persona's
         * WebGL page background stays pinned behind the column (a
         * z-index 0 sibling), so the hero floats over the live plasma
         * and the opaque agents sections cover it as they scroll up.
         */
        <>
          <div
            className={styles.siteBackground}
            style={{
              backgroundColor:
                CREATOR_PERSONA.theme.siteBackgroundColor ?? undefined,
            }}
            aria-hidden="true"
          >
            {CREATOR_PERSONA.theme.siteBackgroundOrb ? (
              <Suspense fallback={null}>
                <ScreenOrbBackground />
              </Suspense>
            ) : CREATOR_PERSONA.theme.siteBackgroundFlow ? (
              <Suspense fallback={null}>
                <FlowFieldBackground
                  baseColor={
                    CREATOR_PERSONA.theme.siteBackgroundColor ?? "#2a0258"
                  }
                />
              </Suspense>
            ) : CREATOR_PERSONA.theme.siteBackgroundUrl ? (
              <img
                src={CREATOR_PERSONA.theme.siteBackgroundUrl}
                className={styles.siteBackgroundImage}
                alt=""
                aria-hidden="true"
                draggable={false}
              />
            ) : null}
          </div>
          <div
            className={styles.landingScroll}
            data-testid="mobile-public-landing-scroll"
            data-public-home-scroll=""
          >
            <div className={styles.heroViewport}>
              <MobileLandingHero persona={CREATOR_PERSONA} />
            </div>
            <div
              className={styles.agentsEmbed}
              // Reserve one viewport of height until the deferred
              // sections mount so the column's geometry doesn't jump.
              style={agentsEmbedReady ? undefined : { minHeight: "100dvh" }}
            >
              {agentsEmbedReady ? (
                <Suspense fallback={null}>
                  <AgentsPageSections />
                </Suspense>
              ) : null}
            </div>
          </div>
        </>
      ) : (
        <>
          <div
            ref={transcriptRef}
            className={styles.transcript}
            aria-live="polite"
            aria-label={t("chat.transcriptAriaLabel", {
              defaultValue: "Chat transcript",
            })}
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
                {composerPlaceholder}
              </div>
            )}
          </div>
          {composerForm}
        </>
      )}
    </div>
  );
}
