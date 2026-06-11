import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Plate } from "../../../components/Plate";
import {
  CreateAgentButton,
  CREATE_AGENT_CLICK_EVENT,
} from "../../public-chat/CreateAgentButton";
import { TypewriterText } from "../../public-chat/TypewriterText";
import { SERVICE_LOGOS } from "./brand-logos";

/**
 * Mock terminal feed for the hero's right-hand LCD: an agent being
 * scaffolded, built, and deployed to the AURA network. Purely decorative
 * (the screen is `aria-hidden`); a `prompt` line renders a `$` glyph, an
 * `ok` line gets a success tint, and the rest read as plain log output.
 */
const TERMINAL_LINES: ReadonlyArray<{
  readonly text: string;
  readonly kind?: "prompt" | "ok";
}> = [
  { text: 'aura agent init --name "Atlas"', kind: "prompt" },
  { text: "scaffolding workspace ... ok", kind: "ok" },
  { text: "wiring 100+ integrations ... ok", kind: "ok" },
  { text: "aura build", kind: "prompt" },
  { text: "compiling skills ... done" },
  { text: "bundling model context ... done" },
  { text: "aura deploy --network aura", kind: "prompt" },
  { text: "uploading bundle (4.2 MB)" },
  { text: "registered on AURA network ... ok", kind: "ok" },
  { text: "agent live - node us-west-2", kind: "ok" },
];

/**
 * The hero's center screen plays one of two clips depending on the active
 * step:
 *   - `INTRO_VIDEO` — the "agents made for you" build animation. It runs once
 *     on initial load and each time the "Identity" step is (re)selected, then
 *     crossfades into the looping clip below.
 *   - `LOOP_VIDEO` — a continuously looping shot of the agent looking into the
 *     camera. It sits under the intro and is what's shown for every other step
 *     (Expertise, Integrations, Connections, Automations, Launch).
 */
const INTRO_VIDEO =
  "/magnific_keep-composition-of-img2-and-have-character-materi_seedance_720p_4-3_24fps_26744.mp4";
const LOOP_VIDEO =
  "/magnific_make-a-looping-video-of-character-looking-into-cam_seedance_720p_4-3_24fps_46282.mp4";

/**
 * The hero's left control panel: a vertical stack of lens buttons standing
 * in for the steps of building an agent on AURA. The first ("Identity") step
 * plays the intro build animation before settling into the looping clip; every
 * other step shows the loop directly.
 */
const SIDE_BUTTONS: ReadonlyArray<{
  readonly label: string;
  /**
   * One-line description streamed into the stage LCD when the row is selected.
   * Kept parallel (imperative, ~40-50 chars) so each reads as a peer step.
   */
  readonly description: string;
}> = [
  { label: "Identity", description: "Create your agent's name and 3D avatar." },
  {
    label: "Expertise",
    description: "Build your agent's core skills and knowledge.",
  },
  {
    label: "Integrations",
    description: "Grant your agent secure access to your data.",
  },
  {
    label: "Connections",
    description: "Link your agent to iMessage, Telegram, and more.",
  },
  {
    label: "Automations",
    description: "Schedule the daily tasks your agent runs for you.",
  },
  { label: "Launch", description: "Birth your agent into the world." },
];

/**
 * Resting pointing direction of the hero knob's orange indicator, in degrees
 * (0 = pointing right, negative = up, matching `Math.atan2` screen coords).
 * The marker sits near the dial's upper-right, so it rests aimed up-right;
 * this offset is subtracted from the cursor angle so the marker tip lands on
 * the pointer rather than the dial's 0deg axis.
 */
const KNOB_REST_ANGLE = -47;

interface ServiceDeviceCardProps {
  /**
   * When true, the bottom grille renders as a recessed three-ring `Plate`
   * inset wrapping a hex-packed metal-and-black mesh (the wide
   * "Agents made for you." hero). Defaults to the flat dot-matrix grille
   * used by the "Connected to everything" quadrant.
   */
  readonly hexGrille?: boolean;
}

/**
 * Mini-UI for the "Connected to everything" quadrant: a recreation of
 * the reference sampler/composer device. The outer body is the shared
 * three-ringed `Plate` panel (matching the chat capsule above), holding
 * an inset, glossy black screen of the services AURA connects to as
 * glowing, emissive on-screen widgets (the monochrome `SERVICE_LOGOS`
 * marks, painted in `currentColor` with a soft glow rather than the old
 * bordered tiles).
 *
 * Below the screen sits the device chrome that sells the hardware
 * fiction: a hairline divider with asterisk markers and a monospace
 * label, then a dot-matrix speaker grille. Everything but the logos is
 * decorative (`aria-hidden`).
 */
export function ServiceDeviceCard({
  hexGrille = false,
}: ServiceDeviceCardProps = {}): ReactNode {
  const { t } = useTranslation("marketing");
  const contentRef = useRef<HTMLDivElement>(null);
  const introVideoRef = useRef<HTMLVideoElement>(null);
  const loopVideoRef = useRef<HTMLVideoElement>(null);
  const knobDialRef = useRef<HTMLDivElement>(null);
  // Whether the intro clip has already been started (seeked to 0) for the
  // current arming. Lets scroll re-entry resume the intro in place rather than
  // restarting it; only a fresh arming (initial load or re-selecting Identity)
  // clears this so the intro replays from the top.
  const introPlayedRef = useRef<boolean>(false);

  // Scroll-activation: the loop video + terminal go live whenever the card
  // scrolls into view, and re-fire each time it re-enters. `replayKey`
  // bumps on every entry so the terminal typewriter (which keys off it)
  // restarts from the top. (The Identity intro build animation is the
  // exception — scrolling away and back resumes it in place rather than
  // restarting; see `introPlayedRef` and the observer below.) The
  // non-`hexGrille` quadrant variant has no video/terminal, and environments
  // without
  // `IntersectionObserver` (e.g. JSDOM) can't observe scroll, so both start
  // active so their content renders fully rather than sitting blank.
  const [isActive, setIsActive] = useState<boolean>(() => {
    if (!hexGrille) {
      return true;
    }
    return typeof IntersectionObserver === "undefined";
  });
  const [replayKey, setReplayKey] = useState<number>(0);
  // Which left-panel item is active; drives the center screen's clip.
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  // Whether the "Identity" intro build animation has finished for the current
  // visit. While false (and Identity is active) the intro clip plays on top of
  // the loop; once it ends it crossfades out to reveal the looping clip.
  const [introDone, setIntroDone] = useState<boolean>(false);
  const isIdentity = selectedIndex === 0;
  const introVisible = isIdentity && !introDone;

  // "Connected to everything" logo grid: a set of currently-lit integrations
  // that gold-glow. The auto-cycle pulses a new logo on a loop so the panel
  // twinkles through different services; clicking a logo pulses just that one.
  // Both paths go through `pulseLogo`, which lights a logo then turns it off
  // after a duration. Only the quadrant variant renders the grid (the hex
  // hero hides it).
  const [litLogos, setLitLogos] = useState<ReadonlySet<number>>(
    () => new Set<number>(),
  );
  const litTimersRef = useRef<Map<number, number>>(new Map());
  // Wall-clock timestamp until which the auto-cycle spotlight is paused.
  // Clicking a logo sets this 2s into the future so the twinkle holds while
  // the visitor inspects their pick. Ref-based so the interval reads it
  // without re-rendering.
  const pauseCycleUntilRef = useRef<number>(0);

  const pulseLogo = useCallback((index: number, durationMs: number) => {
    if (typeof window === "undefined") {
      return;
    }
    setLitLogos((prev) => {
      if (prev.has(index)) {
        return prev;
      }
      const next = new Set(prev);
      next.add(index);
      return next;
    });
    const existing = litTimersRef.current.get(index);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
      setLitLogos((prev) => {
        if (!prev.has(index)) {
          return prev;
        }
        const next = new Set(prev);
        next.delete(index);
        return next;
      });
      litTimersRef.current.delete(index);
    }, durationMs);
    litTimersRef.current.set(index, timer);
  }, []);

  useEffect(() => {
    const timers = litTimersRef.current;
    return () => {
      for (const timer of timers.values()) {
        window.clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);

  useEffect(() => {
    if (hexGrille || SERVICE_LOGOS.length === 0) {
      return;
    }
    if (typeof window === "undefined") {
      return;
    }
    // Step by a stride that's coprime with the count so the spotlight hops
    // around the grid (rather than marching strictly left-to-right) while
    // still visiting every logo before repeating.
    const stride = 5;
    let cycleIndex = 0;
    const timer = window.setInterval(() => {
      // Hold the auto-cycle while a recent click is still within its pause
      // window, so clicking an integration stops the twinkle for 2 seconds.
      if (Date.now() < pauseCycleUntilRef.current) {
        return;
      }
      pulseLogo((cycleIndex * stride) % SERVICE_LOGOS.length, 700);
      cycleIndex += 1;
    }, 600);
    return () => window.clearInterval(timer);
  }, [hexGrille, pulseLogo]);

  useEffect(() => {
    if (!hexGrille || typeof IntersectionObserver === "undefined") {
      return;
    }
    const target = contentRef.current;
    if (!target) {
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setIsActive(true);
            setReplayKey((key) => key + 1);
            // The Identity intro build animation is armed by `introDone` +
            // `introPlayedRef` and seeks to 0 only on a fresh arming (initial
            // load or re-selecting "Identity"). It is intentionally NOT
            // re-armed here, so scrolling away and back resumes the intro in
            // place (or keeps the settled loop once it has finished) rather
            // than restarting from the top.
          } else {
            setIsActive(false);
          }
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(target);
    return () => observer.disconnect();
  }, [hexGrille]);

  // Hero knob follows the cursor: on any mouse movement, rotate the brushed-
  // metal dial so its orange indicator aims at the pointer. Updates are
  // coalesced to one per animation frame; the dial center is re-read each
  // frame so it stays correct as the page scrolls. `KNOB_REST_ANGLE` is the
  // indicator's resting direction (upper-right), subtracted so the marker tip,
  // not the dial's 0deg, points at the cursor.
  useEffect(() => {
    if (!hexGrille || typeof window === "undefined") {
      return;
    }

    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;

    const apply = (): void => {
      frame = 0;
      const dial = knobDialRef.current;
      if (!dial) {
        return;
      }
      const rect = dial.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const deg = (Math.atan2(pointerY - cy, pointerX - cx) * 180) / Math.PI;
      dial.style.transform = `rotate(${deg - KNOB_REST_ANGLE}deg)`;
    };

    const onMove = (event: MouseEvent): void => {
      pointerX = event.clientX;
      pointerY = event.clientY;
      if (frame === 0) {
        frame = window.requestAnimationFrame(apply);
      }
    };

    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [hexGrille]);

  // Clicking any "Create your agent" pill anywhere on the page completes the
  // on-screen build: jump the stepper to the final "Launch" step so the
  // progress bar tweens to 100%. Only the hex hero variant renders the
  // stepper/progress, so the listener is gated to it.
  useEffect(() => {
    if (!hexGrille || typeof window === "undefined") {
      return;
    }
    const onCreateClick = () => {
      setSelectedIndex(SIDE_BUTTONS.length - 1);
    };
    window.addEventListener(CREATE_AGENT_CLICK_EVENT, onCreateClick);
    return () =>
      window.removeEventListener(CREATE_AGENT_CLICK_EVENT, onCreateClick);
  }, [hexGrille]);

  useEffect(() => {
    const loop = loopVideoRef.current;
    const intro = introVideoRef.current;

    if (!isActive) {
      loop?.pause?.();
      intro?.pause?.();
      return;
    }

    // The loop clip runs continuously under everything so the crossfade lands
    // on already-playing motion rather than a frozen first frame.
    void loop?.play?.()?.catch(() => {
      // Autoplay can be rejected (e.g. before user interaction); the clip is
      // muted + decorative, so a silent failure is acceptable.
    });

    // The intro only plays on the Identity step until it finishes. Seek to the
    // top only on a fresh arming (tracked by `introPlayedRef`); on a plain
    // scroll re-entry we resume from the current frame so scrolling away and
    // back doesn't restart the build animation.
    if (introVisible && intro) {
      if (!introPlayedRef.current) {
        try {
          intro.currentTime = 0;
        } catch {
          // Some environments throw when seeking before metadata loads; the
          // play() call below still starts from the buffered start.
        }
        introPlayedRef.current = true;
      }
      void intro.play?.()?.catch(() => {});
    } else {
      intro?.pause?.();
    }
  }, [isActive, replayKey, introVisible]);

  // Build progress reflects how far through the stages the selected step is,
  // so the last step (Launch) reads as 100% complete.
  const progressStage = SIDE_BUTTONS[selectedIndex];
  const progressPercent = Math.round(
    ((selectedIndex + 1) / SIDE_BUTTONS.length) * 100,
  );

  // The bar width animates via CSS; the readout counts up/down to the new
  // percentage (easeOutCubic) so the number tweens between stages rather than
  // snapping. A ref tracks the live value so an interrupted run continues from
  // wherever it currently sits. Like the always-on bar-width transition and the
  // terminal typewriter, this count-up runs regardless of
  // `prefers-reduced-motion`: it's the whole point of the readout, and pinning
  // it to instant text while the glow visibly slides would read as broken.
  const [displayPercent, setDisplayPercent] = useState<number>(progressPercent);
  const displayPercentRef = useRef<number>(progressPercent);

  useEffect(() => {
    const from = displayPercentRef.current;
    const to = progressPercent;
    if (from === to) {
      return;
    }

    // No `requestAnimationFrame` (SSR / JSDOM): jump straight to the target.
    if (typeof requestAnimationFrame === "undefined") {
      displayPercentRef.current = to;
      const id = setTimeout(() => setDisplayPercent(to), 0);
      return () => clearTimeout(id);
    }

    const durationMs = 400;
    const startedAt =
      typeof performance !== "undefined" ? performance.now() : Date.now();
    let frame = 0;

    const step = (): void => {
      const now =
        typeof performance !== "undefined" ? performance.now() : Date.now();
      const t = Math.min(1, (now - startedAt) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(from + (to - from) * eased);
      displayPercentRef.current = value;
      setDisplayPercent(value);
      if (t < 1) {
        frame = requestAnimationFrame(step);
      } else {
        displayPercentRef.current = to;
      }
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [progressPercent]);

  return (
    <>
    {hexGrille ? (
      <div className="madeForYouDeviceCaption" aria-hidden="true">
        <span className="madeForYouPanelCaptionTitle">
          {t("agentBuilder.configure", { defaultValue: "CONFIGURE" })}
        </span>
        <span className="madeForYouPanelCaptionSub">
          {t("agentBuilder.privateAgent", { defaultValue: "YOUR PRIVATE AGENT" })}
        </span>
      </div>
    ) : null}
    <Plate
      className="personalAgentDevice"
      aria-hidden={hexGrille ? undefined : "true"}
    >
      <div className="personalAgentDeviceContent" ref={contentRef}>
        {hexGrille ? (
          <div className="madeForYouSidePanel" aria-hidden="true">
            <div className="madeForYouKnobBay">
              <div className="madeForYouKnob">
                <div className="madeForYouKnobDial" ref={knobDialRef}>
                  <span className="madeForYouKnobIndicator" />
                </div>
              </div>
            </div>

            <div className="madeForYouSideButtons">
              <div className="madeForYouSideScreen">
                {SIDE_BUTTONS.map((item, index) => {
                  const isSelected = index === selectedIndex;
                  const isBelow = index > selectedIndex;
                  const isAbove = index < selectedIndex;
                  const className = [
                    "madeForYouSideRow",
                    isSelected ? "madeForYouSideRow--selected" : "",
                    isBelow ? "madeForYouSideRow--below" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <button
                      type="button"
                      className={className}
                      key={item.label}
                      tabIndex={-1}
                      aria-pressed={isSelected}
                      onClick={() => {
                        setSelectedIndex(index);
                        // Re-arm the intro whenever Identity is (re)selected so
                        // it plays again from the top before settling into the
                        // loop. Clearing `introPlayedRef` lets the playback
                        // effect seek back to 0 on the next activation.
                        if (index === 0) {
                          setIntroDone(false);
                          introPlayedRef.current = false;
                        }
                      }}
                    >
                      <span
                        className="madeForYouSideNumber"
                        aria-hidden="true"
                      >
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <span className="madeForYouSideLabel">
                        {t(`agentBuilder.steps.${index}.label`, {
                          defaultValue: item.label,
                        })}
                      </span>
                      <span className="madeForYouSideIndicator">
                        {isAbove || isSelected ? (
                          <Check
                            className={
                              isSelected
                                ? "madeForYouCheck madeForYouCheck--muted"
                                : "madeForYouCheck"
                            }
                            size={16}
                            strokeWidth={3}
                            aria-hidden="true"
                          />
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="madeForYouSideSpacer" aria-hidden="true" />
          </div>
        ) : null}

        {hexGrille ? (
          <TerminalScreen active={isActive} replayKey={replayKey} />
        ) : null}

        {hexGrille ? (
          <div className="madeForYouCtaSlot" aria-hidden="true">
            <div className="madeForYouBrandPanel">
              <span className="madeForYouBrandMark" />
            </div>
          </div>
        ) : null}

        {hexGrille ? (
          <div className="madeForYouMeshStrip">
            <div className="personalAgentDeviceHexMesh" aria-hidden="true" />
            <div className="madeForYouStageScreen" aria-hidden="true">
              <div className="madeForYouStageGloss" />
              <p className="madeForYouStageText">
                <TypewriterText
                  key={selectedIndex}
                  text={t(`agentBuilder.steps.${selectedIndex}.description`, {
                    defaultValue: progressStage?.description ?? "",
                  })}
                  speedMs={22}
                />
              </p>
            </div>
          </div>
        ) : null}

        <div className="personalAgentDeviceScreen" aria-hidden="true">
          {hexGrille ? (
            <>
              {/*
                `preload="none"`: both clips together are several MB and sit
                far below the fold — fetching starts from the play() calls
                the IntersectionObserver issues when the card scrolls in,
                instead of at page load.
              */}
              <video
                ref={loopVideoRef}
                className="personalAgentDeviceVideo personalAgentDeviceVideo--loop"
                src={LOOP_VIDEO}
                muted
                loop
                playsInline
                preload="none"
              />
              <video
                ref={introVideoRef}
                className="personalAgentDeviceVideo personalAgentDeviceVideo--intro"
                src={INTRO_VIDEO}
                muted
                playsInline
                preload="none"
                data-visible={introVisible ? "true" : undefined}
                onEnded={() => setIntroDone(true)}
              />
              {/*
                Carries the breathing glow ring around the video circle.
                The glow used to be an animated multi-layer box-shadow on
                the <video> itself, which forced a large repaint every
                frame; this overlay bakes the peak shadow once and breathes
                via compositor-only opacity (see MadeForYouSection.css).
              */}
              <span
                className="personalAgentDeviceVideoGlow"
                aria-hidden="true"
              />
            </>
          ) : null}
          <div className="personalAgentDeviceGloss" />
          <div className="personalAgentDeviceLogoGrid">
            {SERVICE_LOGOS.map((logo, index) => (
              <button
                key={logo.id}
                type="button"
                className="personalAgentDeviceLogo"
                data-active={litLogos.has(index) ? "true" : undefined}
                aria-label={logo.label}
                onClick={() => {
                  pauseCycleUntilRef.current = Date.now() + 2000;
                  pulseLogo(index, 1500);
                }}
              >
                <svg
                  width={26}
                  height={26}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d={logo.path} />
                </svg>
              </button>
            ))}
          </div>
        </div>

        {!hexGrille ? (
          <>
            <div className="personalAgentDeviceLabelStrip">
              <div className="personalAgentDeviceMarks">
                <span className="personalAgentDeviceAsterisk">&#10033;</span>
                <span className="personalAgentDeviceAsterisk personalAgentDeviceAsteriskAccent">
                  &#10033;
                </span>
                <span className="personalAgentDeviceAsterisk">&#10033;</span>
              </div>
              <span className="personalAgentDeviceLabel">
                {t("agentBuilder.integrations", {
                  defaultValue: "100+ Integrations",
                })}
              </span>
              <span className="personalAgentDeviceAsterisk">&#10033;</span>
            </div>

            <div className="personalAgentDeviceGrille" />
          </>
        ) : null}
      </div>
    </Plate>
    {hexGrille ? (
      <div className="madeForYouCardCtaSlot">
        <div
          className="madeForYouProgress"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={t("agentBuilder.buildProgressAria", {
            defaultValue: `Build progress: ${progressStage?.label ?? ""}`,
            step: t(`agentBuilder.steps.${selectedIndex}.label`, {
              defaultValue: progressStage?.label ?? "",
            }),
          })}
        >
          <div
            className="madeForYouProgressTrack"
            style={{ ["--progress"]: `${progressPercent}%` } as CSSProperties}
          >
            <div
              className="madeForYouProgressFill"
              style={{ width: `${progressPercent}%` }}
            />
            <span className="madeForYouProgressLabel">{displayPercent}%</span>
          </div>
        </div>
        <CreateAgentButton source="made_for_you" className="madeForYouCta" />
      </div>
    ) : null}
    </>
  );
}

/** Milliseconds between character reveals while a line types in. */
const TERMINAL_CHAR_MS = 26;
/** Brief pause after a line finishes before the next line starts typing. */
const TERMINAL_LINE_PAUSE_MS = 260;
/** Pause on the completed feed (final prompt held) before the loop restarts. */
const TERMINAL_LOOP_PAUSE_MS = 2600;

interface TerminalScreenProps {
  /** Whether the card is in view; gates the typewriter run. */
  readonly active: boolean;
  /** Bumps on each scroll-in so the typewriter restarts from the top. */
  readonly replayKey: number;
}

/**
 * Right-hand side-panel LCD of the hero device: a tall recessed terminal that
 * fills the enlarged right metal panel, typing out a mock feed of an agent
 * being created and deployed to the AURA network. Driven by the parent's
 * scroll-activation: while the card is in view the feed types from the top, one
 * character at a time, with a trailing block caret that follows the active line
 * and settles on a final prompt once the run completes. After a brief hold it
 * collapses back to the top and re-types, looping continuously. The feed is
 * top-anchored so output reads top-to-bottom like a real console.
 * Everything is decorative (`aria-hidden` via the device root).
 *
 * Like the shared `TypewriterText`, the reveal runs regardless of
 * `prefers-reduced-motion`: this LCD is incidental chrome whose whole point is
 * the "agent being built live" motion, so pinning it to instant text would
 * read as a broken, already-finished log.
 */
function TerminalScreen({ active, replayKey }: TerminalScreenProps): ReactNode {
  // `lineIndex` is the line currently typing; `charIndex` is how many of its
  // characters are revealed. Lines before `lineIndex` are shown in full.
  const [lineIndex, setLineIndex] = useState<number>(0);
  const [charIndex, setCharIndex] = useState<number>(0);

  useEffect(() => {
    if (!active) {
      return;
    }

    let line = 0;
    let char = 0;
    let timer: ReturnType<typeof setTimeout>;

    const tick = (): void => {
      const current = TERMINAL_LINES[line];
      if (!current) {
        return;
      }
      if (char < current.text.length) {
        char += 1;
        // Drive both indices from the timer (rather than a synchronous reset
        // in the effect body) so a replay re-collapses the feed to the first
        // line on its own tick.
        setLineIndex(line);
        setCharIndex(char);
        timer = setTimeout(tick, TERMINAL_CHAR_MS);
        return;
      }
      // Line complete: advance to the next one after a short pause.
      line += 1;
      char = 0;
      setLineIndex(line);
      setCharIndex(0);
      if (line >= TERMINAL_LINES.length) {
        // Whole feed typed: `lineIndex` past the end flips `isComplete` so the
        // trailing prompt + blinking caret render below the last line. Hold the
        // completed feed briefly, then collapse back to the top and re-type so
        // the LCD loops continuously while in view.
        timer = setTimeout(() => {
          line = 0;
          char = 0;
          setLineIndex(0);
          setCharIndex(0);
          timer = setTimeout(tick, TERMINAL_CHAR_MS);
        }, TERMINAL_LOOP_PAUSE_MS);
        return;
      }
      timer = setTimeout(tick, TERMINAL_LINE_PAUSE_MS);
    };

    timer = setTimeout(tick, TERMINAL_CHAR_MS);
    return () => clearTimeout(timer);
  }, [active, replayKey]);

  const isComplete = lineIndex >= TERMINAL_LINES.length;

  return (
    <div className="madeForYouTerminalScreen" aria-hidden="true">
      <div className="madeForYouTerminalGloss" />
      <div className="madeForYouTerminalScroll">
        <ul className="madeForYouTerminalLines">
          {TERMINAL_LINES.map((line, index) => {
            if (index > lineIndex) {
              return null;
            }
            const isCurrent = index === lineIndex;
            const visibleText = isCurrent
              ? line.text.slice(0, charIndex)
              : line.text;
            return (
              <li
                key={index}
                className={
                  line.kind
                    ? `madeForYouTerminalLine madeForYouTerminalLine--${line.kind}`
                    : "madeForYouTerminalLine"
                }
              >
                {line.kind === "prompt" ? (
                  <span className="madeForYouTerminalPrompt">$</span>
                ) : null}
                {visibleText}
                {isCurrent && !isComplete ? (
                  <span className="madeForYouTerminalCursor" />
                ) : null}
              </li>
            );
          })}
          {isComplete ? (
            <li className="madeForYouTerminalLine madeForYouTerminalLine--prompt">
              <span className="madeForYouTerminalPrompt">$</span>
              <span className="madeForYouTerminalCursor" />
            </li>
          ) : null}
        </ul>
      </div>
    </div>
  );
}
