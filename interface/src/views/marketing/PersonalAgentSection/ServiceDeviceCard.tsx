import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";
import { Plate } from "../../../components/Plate";
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
 * The hero's left control panel: a vertical stack of lens buttons standing
 * in for the steps of building an agent on AURA. Selecting one swaps the
 * clip playing on the center screen. The `video` paths are placeholders that
 * reuse the available clips; swap in a dedicated clip per section as they
 * land.
 */
const SIDE_BUTTONS: ReadonlyArray<{
  readonly label: string;
  readonly video: string;
}> = [
  {
    label: "Identity",
    video:
      "/magnific_have-character-img1-materialize-from-the-activated_seedance_720p_16-9_24fps_32651.mp4",
  },
  { label: "Expertise", video: "/AURA_visual_loop.mp4" },
  { label: "Integrations", video: "/agent-character-rotate.mp4" },
  { label: "Connections", video: "/personas/creator/desktop.mp4" },
  { label: "Automations", video: "/AURA_visual_loop.mp4" },
  {
    label: "Launch",
    video:
      "/magnific_have-character-img1-materialize-from-the-activated_seedance_720p_16-9_24fps_32651.mp4",
  },
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
  const contentRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const knobDialRef = useRef<HTMLDivElement>(null);

  // Scroll-activation: the video + terminal go live whenever the card
  // scrolls into view, and re-fire each time it re-enters. `replayKey`
  // bumps on every entry so the terminal typewriter (which keys off it)
  // restarts from the top alongside the video. The non-`hexGrille` quadrant
  // variant has no video/terminal, and environments without
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

  useEffect(() => {
    const video = videoRef.current;
    if (!video) {
      return;
    }
    if (isActive) {
      try {
        video.currentTime = 0;
      } catch {
        // Some environments throw when seeking before metadata loads;
        // the play() call below still starts from the buffered start.
      }
      void video.play?.()?.catch(() => {
        // Autoplay can be rejected (e.g. before user interaction); the
        // clip is muted + decorative, so a silent failure is acceptable.
      });
    } else {
      video.pause?.();
    }
    // `selectedIndex` is a dep so picking a new section restarts its clip
    // (the `<video>` is keyed on it, so this effect re-runs on the remount).
  }, [isActive, replayKey, selectedIndex]);

  // Build progress reflects how far through the stages the selected step is,
  // so the last step (Launch) reads as 100% complete.
  const progressStage = SIDE_BUTTONS[selectedIndex];
  const progressPercent = Math.round(
    ((selectedIndex + 1) / SIDE_BUTTONS.length) * 100,
  );

  return (
    <>
    <Plate className="personalAgentDevice" aria-hidden="true">
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
                      onClick={() => setSelectedIndex(index)}
                    >
                      {isAbove ? (
                        <Check
                          className="madeForYouCheck"
                          size={16}
                          strokeWidth={3}
                          aria-hidden="true"
                        />
                      ) : null}
                      {isSelected ? <span className="madeForYouLensBtn" /> : null}
                      <span className="madeForYouSideLabel">{item.label}</span>
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
          <Plate
            radius="0 0 12px 12px"
            className="personalAgentDeviceGrilleInset"
            aria-hidden="true"
          >
            <div className="personalAgentDeviceHexMesh" />
          </Plate>
        ) : null}

        <div className="personalAgentDeviceScreen">
          {hexGrille ? (
            <video
              key={selectedIndex}
              ref={videoRef}
              className="personalAgentDeviceVideo"
              src={SIDE_BUTTONS[selectedIndex]?.video}
              muted
              playsInline
              preload="auto"
            />
          ) : null}
          <div className="personalAgentDeviceGloss" />
          <div className="personalAgentDeviceLogoGrid">
            {SERVICE_LOGOS.map((logo) => (
              <div key={logo.id} className="personalAgentDeviceLogo">
                <svg
                  width={26}
                  height={26}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  role="img"
                  aria-label={logo.label}
                >
                  <path d={logo.path} />
                </svg>
              </div>
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
              <span className="personalAgentDeviceLabel">100+ Integrations</span>
              <span className="personalAgentDeviceAsterisk">&#10033;</span>
            </div>

            <div className="personalAgentDeviceGrille" />
          </>
        ) : null}
      </div>
    </Plate>
      {hexGrille ? (
        <div
          className="madeForYouProgress"
          role="progressbar"
          aria-valuenow={progressPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Build progress: ${progressStage?.label ?? ""}`}
        >
          <div className="madeForYouProgressTrack">
            <div
              className="madeForYouProgressFill"
              style={{ width: `${progressPercent}%` }}
            />
            <span className="madeForYouProgressLabel">{progressPercent}%</span>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** Milliseconds between character reveals while a line types in. */
const TERMINAL_CHAR_MS = 26;
/** Brief pause after a line finishes before the next line starts typing. */
const TERMINAL_LINE_PAUSE_MS = 260;

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
 * scroll-activation: each time the card enters view the feed types from the
 * top, one character at a time, with a trailing block caret that follows the
 * active line and settles on a final prompt once the run completes. The feed
 * is top-anchored so output reads top-to-bottom like a real console.
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
        // trailing prompt + blinking caret render below the last line.
        return;
      }
      timer = setTimeout(tick, TERMINAL_LINE_PAUSE_MS);
    };

    timer = setTimeout(tick, TERMINAL_CHAR_MS);
    return () => clearTimeout(timer);
  }, [active, replayKey]);

  const isComplete = lineIndex >= TERMINAL_LINES.length;

  return (
    <div className="madeForYouTerminalScreen">
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
