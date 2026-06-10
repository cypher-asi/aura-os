import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";
import { useTheme } from "@cypher-asi/zui";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
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
import { ComposePanel } from "../ComposePanel";
import { ScreenOrbBackground } from "./ScreenOrbBackground";
import { FlowFieldBackground } from "./FlowFieldBackground";
import { CreateAgentButton } from "../CreateAgentButton";
import { PersonaTickRail } from "../PersonaTickRail";
import { PublicChatBubble } from "../PublicChatBubble";
import { TypewriterText } from "../TypewriterText";
import { OverlayScrollbar } from "../../../components/OverlayScrollbar";
import { deriveChatPalette } from "../MockAuraApp/derive-chat-palette";
import { PERSONAS, getPersonaAt, type Persona } from "../personas";
import styles from "./PublicChatView.module.css";

/*
 * The full `/agents` marketing section stack, embedded below the
 * persona-carousel hero so wheeling past the last persona scrolls
 * seamlessly into the agents story without a route change. Lazy so
 * the landing page's initial chunk stays unchanged — the sections
 * mount below the fold as soon as the chunk arrives, which warms
 * their media + IntersectionObserver animations long before the
 * visitor finishes the persona cycle.
 */
const AgentsPageSections = lazy(
  () => import("../../marketing/ProductView/AgentsPageSections"),
);

/**
 * Right-side surface for the public (logged-out) shell.
 *
 * Persona swap: dissolve through a layered overlap
 * ------------------------------------------------
 * Picking a new tick swaps the painted persona immediately — there
 * is no delayed fade-out window. Instead the OUTGOING persona is
 * captured into a second layer that mounts ON TOP of the new
 * committed layer and fades from opacity 1 → 0 over `FADE_MS`. The
 * new layer underneath sits at full opacity the entire time, so as
 * the outgoing layer dissolves the new content is revealed beneath
 * it. The visitor sees the old persona "fade into" the new one
 * with no black hold and no parent-bg leak.
 *
 * The during-render setState below (the "Adjusting State Based on
 * Props" pattern from the React docs) is what guarantees BOTH
 * layers land in the same paint as the click. Deferring the
 * outgoing-layer mount to a `useEffect` would mean the new layer
 * paints alone for one frame before the outgoing layer mounts on
 * top, producing a visible snap-in.
 *
 * Each layer is still a SINGLE `<div>` carrying both the persona
 * color (on the wrapper) and the wallpaper / site image (as an
 * inner `<img>`), so color + image always dissolve as one
 * snapshot. Two layers stacked × one `<div>` per layer = exactly
 * the "wallpaper + image as one div" model the user asked for; the
 * layering is purely about the overlap between the OLD snapshot
 * and the NEW snapshot, not about splitting color from image.
 */

interface PersonaBgSnapshot {
  readonly persona: Persona;
  readonly fadeKey: number;
}

interface PersonaSwapState {
  readonly committedIndex: number;
  readonly outgoing: PersonaBgSnapshot | null;
  readonly nextFadeKey: number;
}

// Duration of the outgoing layer's opacity fade-out animation.
// Must match the `fadeOut` keyframe durations in
// `PublicChatView.module.css` and `MockAuraApp.module.css` so the
// React teardown timer (`FADE_MS + 50`) clears the outgoing layer
// exactly one frame after its animation lands at opacity 0.
const FADE_MS = 550;

// Floor on `event.deltaY` magnitude before a wheel event counts as
// a vertical scroll. Filters out near-zero noise from horizontal
// trackpad gestures that some browsers fold into `deltaY` as
// tiny sub-pixel values — without this guard a sideways two-finger
// swipe would occasionally trip a persona change.
const WHEEL_DELTA_THRESHOLD = 4;
const PUBLIC_CHAT_PATH = "/chat";

// Duration of the programmatic glide from the persona hero into the
// embedded agents page (one viewport height) after the visitor wheels
// past the LAST persona. A cubic ease-out over ~700ms reads as "the
// page takes over and settles" rather than a teleport, and an rAF
// tween (instead of `scrollTo({ behavior: "smooth" })`) gives us a
// deterministic completion signal plus a consistent curve across
// platforms.
const AGENTS_AUTO_SCROLL_MS = 700;

// Momentum-settle window for re-entering carousel mode. When an
// upward fling brings the scroll column back to `scrollTop === 0`,
// the trackpad keeps streaming inertial wheel-up events; without a
// settle guard those leftovers would blast backward through several
// personas the instant the carousel re-locks. Wheel events are
// swallowed until this many ms pass with NO wheel activity, so the
// fling lands you on the last persona and the next deliberate
// gesture resumes cycling.
const WHEEL_SETTLE_MS = 160;

// Theme-invariant dark-mode nav foreground pair, mirrored from
// `PublicMarketingPanel`. Published on <html> while the visitor is
// scrolled into the embedded agents content (near-black sections) so
// the persistent `PublicSidebarFooter` nav stays readable; the active
// persona's own pair is restored as the visitor scrolls back up into
// the hero.
const MARKETING_NAV_FG_COLOR = "#e6e8eb";
const MARKETING_NAV_FG_COLOR_MUTED = "#c9c9cf";

// Taglines cycled by the landing hero's looping typewriter (type ->
// hold -> erase -> next -> repeat). The first/longest entry doubles as
// the `.heroHeadline` `data-text` width reserve so the centered box
// never reflows as the shorter phrases stream in and out.
const HERO_PHRASES = [
  "Your Private Agent.",
  "Build Anything.",
  "Imagine Anything.",
  "Code Anything.",
  "Just by Chatting.",
] as const;

/**
 * Perceived-luminance test for a `#rgb` / `#rrggbb` hex color. Used to
 * decide the hero tagline's polarity from the active persona's nav
 * foreground: a light foreground (or none) means the site bg is dark,
 * so the tagline should be pure white; a dark foreground means a light
 * site bg, so the tagline should stay dark.
 */
function isLightColor(hex: string): boolean {
  const raw = hex.trim().replace("#", "");
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw;
  if (full.length < 6) return true;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5;
}

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

export function PublicChatView(): React.ReactElement {
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

  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const streamRef = useRef<PublicChatStreamHandle | null>(null);
  const heroSlotRef = useRef<HTMLDivElement | null>(null);
  const heroStageRef = useRef<HTMLDivElement | null>(null);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  // Whether the visitor has scrolled past ~half the hero viewport into
  // the embedded agents content. Drives the nav foreground handoff
  // (persona pair <-> marketing dark pair) — see the nav-vars effect.
  const [inAgentsRegion, setInAgentsRegion] = useState(false);

  // Mirrors for the native wheel/scroll listeners, which live outside
  // the React render cycle. `activeIndexRef` tracks the committed
  // persona index; the rest carry the carousel <-> scroll state
  // machine described on the wheel effect below.
  const activeIndexRef = useRef(activeIndex);
  const inAgentsRegionRef = useRef(false);
  const lastWheelAtRef = useRef(0);
  const lastScrollTopRef = useRef(0);
  const relockGuardRef = useRef(false);
  const autoScrollRef = useRef<{ raf: number } | null>(null);
  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  const [swap, setSwap] = useState<PersonaSwapState>(() => ({
    committedIndex: 0,
    outgoing: null,
    nextFadeKey: 1,
  }));

  const activeSession =
    activeSessionId != null ? sessions[activeSessionId] ?? null : null;

  // Note: `/chat` without a valid `?session=` deliberately does NOT
  // auto-mint a session here. Sessions are minted by exactly two
  // explicit actions: the `+` button in `AuraSidebar.handleNewChat`,
  // and the first call to `handleSubmit` below. This keeps the
  // delete flow working — if the visitor deletes the only session,
  // they land back on `/chat` with an empty composer rather than
  // watching a fresh "New chat" row spawn on top of the one they
  // just removed.

  // Vertically center the "Your Private Agent." tagline in the band
  // between the shell top bar (the hero slot's top edge) and the top of
  // the mock desktop widget. The widget is sized off its container via
  // container queries, so its top edge moves with viewport size/aspect
  // (height-bound on wide screens, width-bound on tall ones). A static
  // CSS offset can only match one regime, so we measure the live top
  // edges and recenter on every resize, writing the midpoint into a
  // CSS var the overlay reads. Runs layout-effect + rAF so the value is
  // applied before paint (no flash) and after the widget has laid out.
  useLayoutEffect(() => {
    if (isChatPage) return;
    const slot = heroSlotRef.current;
    const stage = heroStageRef.current;
    if (!slot || !stage) return;

    let raf = 0;
    const measure = (): void => {
      const widget = stage.querySelector<HTMLElement>('[class*="appFrame"]');
      if (!widget) return;
      const slotTop = slot.getBoundingClientRect().top;
      const stageTop = stage.getBoundingClientRect().top;
      const widgetTop = widget.getBoundingClientRect().top;
      // Midpoint between the top bar (slot top) and the widget top,
      // expressed relative to the stage (the overlay's containing block).
      const centerWithinStage = (slotTop + widgetTop) / 2 - stageTop;
      stage.style.setProperty(
        "--hero-headline-center",
        `${Math.round(centerWithinStage)}px`
      );
    };
    const schedule = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };

    schedule();
    const ro = new ResizeObserver(schedule);
    ro.observe(slot);
    ro.observe(stage);
    const widget = stage.querySelector<HTMLElement>('[class*="appFrame"]');
    if (widget) ro.observe(widget);
    window.addEventListener("resize", schedule);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener("resize", schedule);
    };
  }, [isChatPage]);

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

  // Detect a persona change during render and capture the outgoing
  // snapshot in the same paint as the new committed index. The
  // `if` guard guarantees the setter only runs when activeIndex
  // diverges from the committed index, so this can't loop.
  if (swap.committedIndex !== activeIndex) {
    setSwap((prev) => ({
      committedIndex: activeIndex,
      outgoing: {
        persona: getPersonaAt(prev.committedIndex),
        fadeKey: prev.nextFadeKey,
      },
      nextFadeKey: prev.nextFadeKey + 1,
    }));
  }

  // Tear the outgoing layer down a frame after its fade-out
  // animation completes. The closure captures the fadeKey for
  // THIS swap so a rapid second click that mounts a NEWER outgoing
  // layer never gets cleared by a stale timer.
  const outgoingFadeKey = swap.outgoing?.fadeKey;
  useEffect(() => {
    if (outgoingFadeKey == null) return;
    const timer = window.setTimeout(() => {
      setSwap((prev) =>
        prev.outgoing?.fadeKey === outgoingFadeKey
          ? { ...prev, outgoing: null }
          : prev,
      );
    }, FADE_MS + 50);
    return () => window.clearTimeout(timer);
  }, [outgoingFadeKey]);

  const activePersona = useMemo(() => getPersonaAt(activeIndex), [activeIndex]);
  const committedPersona = useMemo(
    () => getPersonaAt(swap.committedIndex),
    [swap.committedIndex],
  );
  const outgoingPersona = swap.outgoing?.persona ?? null;

  // Single ingress for persona swaps. Both the right-edge
  // `PersonaTickRail` and the bottom-left avatar dock inside
  // `MockAuraApp` call this with their selected index so the two
  // surfaces share one piece of state — clicking the rail updates
  // the dock's border, and clicking a dock avatar updates the
  // rail's aria-current. The in-bounds guard mirrors what the rail
  // callback previously inlined; nothing else should ever pass an
  // out-of-range index, but the guard is cheap insurance against a
  // future caller drifting from the contract.
  const handleActiveIndexChange = useCallback((next: number): void => {
    if (next < 0 || next >= PERSONAS.length) return;
    setActiveIndex(next);
  }, []);

  // Wheel-driven persona carousel + scroll-into-agents state machine.
  //
  // The landing surface is a scroll column whose first child is the
  // 100%-height persona hero and whose second child is the embedded
  // `/agents` section stack. The column behaves in two modes keyed
  // off `scrollTop`:
  //
  //   LOCKED (scrollTop === 0) — carousel mode. Wheel events are
  //   intercepted (`preventDefault`): wheel-down advances one persona
  //   per event (no time-based throttle — same snappy contract as
  //   before), wheel-up rewinds one, both CLAMPED at the ends. The
  //   old infinite wrap is gone because "past the last persona" is
  //   now a meaningful boundary: the wheel-down AFTER the last
  //   persona kicks off an rAF tween that glides the column one
  //   viewport height down into the agents hero.
  //
  //   UNLOCKED (scrollTop > 0) — agents mode. Nothing is
  //   intercepted; the visitor scrolls the agents page natively.
  //   When an upward scroll lands the column back at the top, the
  //   carousel re-locks behind a momentum-settle guard (see
  //   WHEEL_SETTLE_MS) so leftover trackpad inertia doesn't blast
  //   backward through several personas.
  //
  // This is a NATIVE non-passive listener (not React `onWheel`)
  // because React registers root wheel listeners as passive, which
  // makes `preventDefault()` a no-op — and the locked mode depends
  // on actually cancelling the scroll.
  //
  // Gated on `!isChatPage`: the chat surface hides the tick rail and
  // hero, so there's no affordance explaining the gesture, and the
  // scroll column itself doesn't mount there.
  const cancelAgentsAutoScroll = useCallback((): void => {
    if (autoScrollRef.current != null) {
      cancelAnimationFrame(autoScrollRef.current.raf);
      autoScrollRef.current = null;
    }
  }, []);

  const startAgentsAutoScroll = useCallback((): void => {
    const scroller = scrollerRef.current;
    if (!scroller || autoScrollRef.current != null) return;
    const from = scroller.scrollTop;
    const target = scroller.clientHeight;
    if (target <= from) return;

    const prefersReduce =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduce) {
      scroller.scrollTop = target;
      return;
    }

    const start = performance.now();
    // Identity object doubles as a cancellation token: a wheel-up or
    // unmount swaps `autoScrollRef.current` away from `state`, and
    // any already-queued frame sees the mismatch and goes inert.
    const state = { raf: 0 };
    autoScrollRef.current = state;
    const step = (now: number): void => {
      if (autoScrollRef.current !== state) return;
      const t = Math.min(1, (now - start) / AGENTS_AUTO_SCROLL_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      scroller.scrollTop = from + (target - from) * eased;
      if (t < 1) {
        state.raf = requestAnimationFrame(step);
      } else {
        autoScrollRef.current = null;
      }
    };
    state.raf = requestAnimationFrame(step);
  }, []);

  useEffect(() => {
    if (isChatPage) return;
    const scroller = scrollerRef.current;
    if (!scroller) return;

    const handleWheel = (event: WheelEvent): void => {
      const delta = event.deltaY;
      if (Math.abs(delta) < WHEEL_DELTA_THRESHOLD) return;
      const now = performance.now();
      const prevWheelAt = lastWheelAtRef.current;
      lastWheelAtRef.current = now;

      // Glide into agents in flight: wheel-down is swallowed so
      // momentum doesn't fight (or double) the tween; wheel-up hands
      // control straight back to the visitor — cancel the tween and
      // let the native scroll carry them up from wherever it reached.
      if (autoScrollRef.current != null) {
        if (delta > 0) {
          event.preventDefault();
        } else {
          cancelAgentsAutoScroll();
        }
        return;
      }

      // Agents mode: fully native scroll.
      if (scroller.scrollTop > 0) return;

      // Carousel mode. Swallow inertial leftovers from the fling
      // that just re-locked the carousel: only a gap of
      // WHEEL_SETTLE_MS with no wheel activity re-arms cycling.
      if (relockGuardRef.current) {
        if (now - prevWheelAt < WHEEL_SETTLE_MS) {
          event.preventDefault();
          return;
        }
        relockGuardRef.current = false;
      }

      event.preventDefault();
      if (delta > 0) {
        if (activeIndexRef.current >= PERSONAS.length - 1) {
          startAgentsAutoScroll();
        } else {
          setActiveIndex((prev) => Math.min(prev + 1, PERSONAS.length - 1));
        }
      } else {
        setActiveIndex((prev) => Math.max(prev - 1, 0));
      }
    };

    const handleScroll = (): void => {
      const top = scroller.scrollTop;
      // Re-lock: arriving back at the very top from the agents
      // region arms the momentum-settle guard.
      if (top <= 0 && lastScrollTopRef.current > 0) {
        relockGuardRef.current = true;
      }
      lastScrollTopRef.current = top;

      const inAgents = top > scroller.clientHeight * 0.5;
      if (inAgents !== inAgentsRegionRef.current) {
        inAgentsRegionRef.current = inAgents;
        setInAgentsRegion(inAgents);
      }
    };

    scroller.addEventListener("wheel", handleWheel, { passive: false });
    scroller.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      scroller.removeEventListener("wheel", handleWheel);
      scroller.removeEventListener("scroll", handleScroll);
      cancelAgentsAutoScroll();
    };
  }, [isChatPage, cancelAgentsAutoScroll, startAgentsAutoScroll]);

  // Foreground vars + CTA glow bound to the ACTIVE persona so the
  // tick click flips them instantly, matching the rail's
  // aria-current. The page bg + wallpaper bind to committedPersona
  // (= activeIndex's persona by the end of the render) but the
  // overlay layer carries the OLD persona while it fades.
  useEffect(() => {
    const root = document.documentElement;
    const { siteForegroundColor, siteForegroundColorMuted } = activePersona.theme;
    const apply = (name: string, value: string | null): void => {
      if (value) {
        root.style.setProperty(name, value);
      } else {
        root.style.removeProperty(name);
      }
    };
    // While scrolled into the embedded agents content the persona bg
    // is covered by the near-black marketing sections, so the nav
    // foreground hands off to the same theme-invariant dark pair
    // `PublicMarketingPanel` publishes on `/agents`; scrolling back
    // up into the hero restores the persona's own pair.
    apply(
      "--public-nav-fg-color",
      inAgentsRegion ? MARKETING_NAV_FG_COLOR : siteForegroundColor,
    );
    apply(
      "--public-nav-fg-color-muted",
      inAgentsRegion ? MARKETING_NAV_FG_COLOR_MUTED : siteForegroundColorMuted,
    );
    // Hero tagline color: an explicit per-persona `heroHeadlineColor`
    // wins (e.g. a dark tagline over a dark-bg persona whose nav stays
    // light); otherwise derive polarity from the nav foreground — pure
    // white when it reads light (or is unset → dark site bg), else the
    // persona's dark foreground so the tagline matches the nav at full
    // contrast.
    const headlineColor =
      activePersona.theme.heroHeadlineColor ??
      (!siteForegroundColor || isLightColor(siteForegroundColor)
        ? "#ffffff"
        : siteForegroundColor);
    apply("--hero-headline-color", headlineColor);
    return () => {
      root.style.removeProperty("--public-nav-fg-color");
      root.style.removeProperty("--public-nav-fg-color-muted");
      root.style.removeProperty("--hero-headline-color");
    };
  }, [activePersona, inAgentsRegion]);

  // Chat palette bound to the COMMITTED persona so the in-window
  // text tokens flip in the same render as the wallpaper.
  const { resolvedTheme } = useTheme();
  const chatPalette = useMemo(
    () =>
      deriveChatPalette(
        committedPersona.theme.siteBackgroundColor,
        resolvedTheme,
      ),
    [committedPersona, resolvedTheme],
  );

  const chatViewStyle = useMemo<CSSProperties | undefined>(() => {
    const { siteCtaGlowColor } = activePersona.theme;
    if (!siteCtaGlowColor) return undefined;
    const style: CSSProperties & Record<"--public-cta-glow-color", string> =
      {} as CSSProperties & Record<"--public-cta-glow-color", string>;
    style["--public-cta-glow-color"] = siteCtaGlowColor;
    return style;
  }, [activePersona]);

  // GPU-resident preload list. Rendered as `<img>` siblings inside
  // `.preloadStash` so the browser keeps each bitmap warm for the
  // lifetime of the shell.
  const preloadUrls = useMemo<readonly string[]>(() => {
    const all = new Set<string>();
    for (const persona of PERSONAS) {
      const { desktopBackgroundUrl, siteBackgroundUrl } = persona.theme;
      if (desktopBackgroundUrl) all.add(desktopBackgroundUrl);
      if (siteBackgroundUrl) all.add(siteBackgroundUrl);
    }
    return Array.from(all);
  }, []);

  const committedSiteBgStyle: CSSProperties = {
    backgroundColor: committedPersona.theme.siteBackgroundColor ?? undefined,
  };
  const outgoingSiteBgStyle: CSSProperties | null = outgoingPersona
    ? {
        backgroundColor: outgoingPersona.theme.siteBackgroundColor ?? undefined,
      }
    : null;

  return (
    <div
      className={styles.chatView}
      data-persona-id={committedPersona.id}
      data-testid="public-chat-view"
      style={chatViewStyle}
    >
      {/*
       * Current page bg layer — paints the new persona's color +
       * image at full opacity, no animation. The outgoing layer
       * below (when present) sits on top of this with a fade-out
       * animation so as the outgoing pixels disappear, these new
       * pixels are revealed beneath them — the "fade into one
       * another" effect with no dark midpoint.
       */}
      <div
        className={styles.siteBackground}
        style={committedSiteBgStyle}
        data-testid="public-chat-site-bg"
        aria-hidden="true"
      >
        {committedPersona.theme.siteBackgroundOrb ? (
          <ScreenOrbBackground key={committedPersona.id} />
        ) : committedPersona.theme.siteBackgroundFlow ? (
          <FlowFieldBackground
            key={committedPersona.id}
            baseColor={committedPersona.theme.siteBackgroundColor ?? "#2a0258"}
          />
        ) : committedPersona.theme.siteBackgroundUrl ? (
          <img
            src={committedPersona.theme.siteBackgroundUrl}
            className={styles.siteBackgroundImage}
            alt=""
            aria-hidden="true"
            draggable={false}
            decoding="sync"
            data-testid="public-chat-site-bg-image"
          />
        ) : null}
      </div>
      {outgoingPersona && outgoingSiteBgStyle ? (
        <div
          key={`site-bg-out-${swap.outgoing?.fadeKey}`}
          className={`${styles.siteBackground} ${styles.siteBackgroundLeaving}`}
          style={outgoingSiteBgStyle}
          data-testid="public-chat-site-bg-outgoing"
          aria-hidden="true"
        >
          {outgoingPersona.theme.siteBackgroundUrl ? (
            <img
              src={outgoingPersona.theme.siteBackgroundUrl}
              className={styles.siteBackgroundImage}
              alt=""
              aria-hidden="true"
              draggable={false}
              decoding="sync"
            />
          ) : null}
        </div>
      ) : null}
      {/*
       * Landing scroll column — the surface the wheel/scroll state
       * machine drives. First child is the 100%-height persona hero
       * (the carousel viewport: MockAuraApp window, tick rail, CTA),
       * second is the embedded `/agents` section stack. While the
       * column sits at `scrollTop === 0` the wheel listener cycles
       * personas; wheeling past the LAST persona glides the column
       * into the agents content, and scrolling back to the top
       * re-enters the carousel. Chat mode (`/chat`) unmounts the
       * whole column so the chat surface, input bar, and persona
       * page bg own the visual field — and the scripted DM timers /
       * dock magnifier inside the hero stop running.
       */}
      {!isChatPage ? (
        <div
          className={styles.scrollColumn}
          ref={scrollerRef}
          data-testid="public-chat-scroll"
        >
          <div className={styles.heroViewport}>
            <div className={styles.heroSlot} ref={heroSlotRef}>
              <div className={styles.heroStage} ref={heroStageRef}>
                <div className={styles.heroHeadlineZone}>
                  <span
                    className={styles.heroHeadline}
                    data-text="Your Private Agent."
                  >
                    <TypewriterText
                      text="Your Private Agent."
                      phrases={HERO_PHRASES}
                      speedMs={45}
                    />
                  </span>
                </div>
                <ComposePanel
                  desktopBackgroundUrl={
                    committedPersona.theme.desktopBackgroundUrl
                  }
                  desktopBackgroundVideoUrl={
                    committedPersona.theme.desktopBackgroundVideoUrl ?? null
                  }
                  desktopBackgroundPosition={
                    committedPersona.theme.desktopBackgroundPosition
                  }
                  desktopBackgroundFit={
                    committedPersona.theme.desktopBackgroundFit
                  }
                  desktopBackgroundColor={
                    committedPersona.theme.desktopBackgroundColor
                  }
                  desktopBackgroundScale={
                    committedPersona.theme.desktopBackgroundScale
                  }
                  desktopBackgroundOffsetY={
                    committedPersona.theme.desktopBackgroundOffsetY
                  }
                  outgoingDesktopBackground={
                    outgoingPersona && swap.outgoing
                      ? {
                          url: outgoingPersona.theme.desktopBackgroundUrl,
                          videoUrl:
                            outgoingPersona.theme.desktopBackgroundVideoUrl ??
                            null,
                          position:
                            outgoingPersona.theme.desktopBackgroundPosition,
                          fit: outgoingPersona.theme.desktopBackgroundFit,
                          color: outgoingPersona.theme.desktopBackgroundColor,
                          scale: outgoingPersona.theme.desktopBackgroundScale,
                          offsetY:
                            outgoingPersona.theme.desktopBackgroundOffsetY,
                          fadeKey: swap.outgoing.fadeKey,
                        }
                      : null
                  }
                  chatPalette={chatPalette}
                  activePersonaIndex={activeIndex}
                  onPersonaSelect={handleActiveIndexChange}
                />
              </div>
            </div>
            {/*
             * Right-edge persona selector. Lives inside the hero
             * viewport so it scrolls away with the carousel — once
             * the visitor is in the agents content there's no
             * persona affordance floating over the marketing story.
             */}
            <div className={styles.tickRailSlot}>
              <PersonaTickRail
                activeIndex={activeIndex}
                onActiveIndexChange={handleActiveIndexChange}
              />
            </div>
            <div className={styles.ctaSlot}>
              <CreateAgentButton source="public_chat" />
            </div>
          </div>
          <div className={styles.agentsEmbed}>
            <Suspense fallback={null}>
              <AgentsPageSections />
            </Suspense>
          </div>
        </div>
      ) : null}
      {isChatPage ? (
        <div className={styles.chatSurface} aria-live="polite">
          {activeSession && activeSession.turns.length > 0 ? (
            <div className={styles.transcript} aria-label="Chat transcript">
              {activeSession.turns.map((message, idx) => {
                // The in-flight assistant turn is identified by being
                // the last assistant message in the turns array while
                // `streamPublicChat` is still appending deltas. Pass
                // `isStreaming` so `LLMOutput` / `ActivityTimeline`
                // applies the live-streaming chrome (and, once the
                // backend forwards `thinking_delta` for public chat,
                // the Phase 1 synthetic Brain "Thinking..." Block will
                // surface here automatically — see TODO(thinking) in
                // `public-chat-store.ts`).
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
              })}
            </div>
          ) : null}
        </div>
      ) : null}
      {isChatPage ? (
        <form
          className={styles.inputBarSlot}
          onSubmit={handleSubmit}
          autoComplete="off"
        >
          <label className={styles.inputLabel} htmlFor="public-chat-input">
            Message Aura
          </label>
          <input
            id="public-chat-input"
            className={styles.chatInput}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Ask Aura anything..."
            disabled={isSending}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus
          />
          <button
            type="submit"
            className={styles.sendButton}
            disabled={isSending || draft.trim().length === 0}
          >
            {isSending ? "Sending" : "Send"}
          </button>
          {sendError ? <p className={styles.sendError}>{sendError}</p> : null}
        </form>
      ) : (
        <OverlayScrollbar scrollRef={scrollerRef} />
      )}
      <div className={styles.preloadStash} aria-hidden="true">
        {preloadUrls.map((url) => (
          <img
            key={url}
            src={url}
            alt=""
            aria-hidden="true"
            draggable={false}
            loading="eager"
            decoding="sync"
            data-testid="public-chat-preload-img"
          />
        ))}
      </div>
    </div>
  );
}
