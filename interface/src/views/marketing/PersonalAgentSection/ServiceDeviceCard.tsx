import { useEffect, useRef, useState, type ReactNode } from "react";
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
  }, [isActive, replayKey]);

  return (
    <Plate className="personalAgentDevice" aria-hidden="true">
      <div className="personalAgentDeviceContent" ref={contentRef}>
        {hexGrille ? (
          <div className="madeForYouSidePanel" aria-hidden="true">
            <div className="madeForYouKnob">
              <div className="madeForYouKnobDial">
                <span className="madeForYouKnobIndicator" />
              </div>
            </div>

            <div className="madeForYouSideRow">
              <span className="madeForYouSideLabel">PAGES</span>
              <span className="madeForYouSideBtn" />
            </div>

            <div className="madeForYouSideRow">
              <span className="madeForYouSideLabel">LOC</span>
              <span className="madeForYouSideBtn" />
            </div>

            <div className="madeForYouSideRow">
              <span className="madeForYouSideGlyph" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M4 9v6h4l5 4V5L8 9H4z"
                    fill="currentColor"
                  />
                  <path
                    d="M16 8.5a5 5 0 0 1 0 7M18.5 6a8.5 8.5 0 0 1 0 12"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <span className="madeForYouSideBtn" />
            </div>

            <div className="madeForYouSideRow">
              <span className="madeForYouSideGlyph" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11 6 4 12l7 6V6zm9 0-7 6 7 6V6z" />
                </svg>
              </span>
              <span className="madeForYouSideBtn" />
            </div>

            <div className="madeForYouSideRow">
              <span className="madeForYouSideGlyph" aria-hidden="true">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13 6 20 12l-7 6V6zM4 6l7 6-7 6V6z" />
                </svg>
              </span>
              <span className="madeForYouSideBtn" />
            </div>
          </div>
        ) : null}

        {hexGrille ? (
          <TerminalScreen active={isActive} replayKey={replayKey} />
        ) : null}

        <div className="personalAgentDeviceScreen">
          {hexGrille ? (
            <video
              ref={videoRef}
              className="personalAgentDeviceVideo"
              src="/agent-character-rotate.mp4"
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

        {hexGrille ? (
          <Plate
            radius="12px"
            className="personalAgentDeviceGrilleInset"
            aria-hidden="true"
          >
            <div className="personalAgentDeviceHexMesh" />
          </Plate>
        ) : (
          <div className="personalAgentDeviceGrille" />
        )}
      </div>
    </Plate>
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
 * active line and settles on a final prompt once the run completes. Older
 * lines bottom-anchor and scroll off the top as the log grows. Everything is
 * decorative (`aria-hidden` via the device root).
 *
 * `prefers-reduced-motion: reduce` short-circuits the per-character reveal and
 * renders the full log immediately — this LCD is incidental chrome, so motion-
 * sensitive users get the same content without the animation.
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

    const prefersReducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

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
      if (line >= TERMINAL_LINES.length) {
        return;
      }
      setLineIndex(line);
      setCharIndex(0);
      timer = setTimeout(tick, TERMINAL_LINE_PAUSE_MS);
    };

    if (prefersReducedMotion) {
      // Reduced motion: skip the reveal and show the whole feed at once.
      timer = setTimeout(() => {
        setLineIndex(TERMINAL_LINES.length);
        setCharIndex(0);
      }, 0);
      return () => clearTimeout(timer);
    }

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
        </ul>
      </div>
      {isComplete ? (
        <div className="madeForYouTerminalCaret">
          <span className="madeForYouTerminalPrompt">$</span>
          <span className="madeForYouTerminalCursor" />
        </div>
      ) : null}
    </div>
  );
}
