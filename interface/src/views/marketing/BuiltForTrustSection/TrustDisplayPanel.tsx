import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { Plate } from "../../../components/Plate";
import { TypewriterText } from "../../public-chat/TypewriterText";
import type { DeviceTier } from "../IsolatedDevice/isolated-device-scene";
import "./TrustDisplayPanel.css";

/** CD-transport frame rate the uptime readout counts in (M:SS:FF). */
const FRAMES_PER_SECOND = 75;
/** How often the uptime readout repaints. */
const TICK_MS = 120;
/** Cells in the segmented attestation bar. */
const SEGMENT_COUNT = 14;

/**
 * Per-computer readout copy: shown on the display glass for whichever
 * computer in the WebGL stack is hovered/active. Each description is one
 * continuous string (no hard breaks) written to wrap to ~3 lines on the
 * display glass.
 */
const TIER_READOUTS: Record<
  DeviceTier,
  { title: string; description: string }
> = {
  top: {
    title: "AURA Router",
    description:
      "A secure routing layer brokering every request across open source and frontier models.",
  },
  middle: {
    title: "AURA Runtime Harness",
    description:
      "All data flows through AURA's custom harness. Every step is atomic, immutable and audited.",
  },
  bottom: {
    title: "AURA Swarm",
    description:
      "An isolated trusted execution environment. Your keys never leave it and the host sees nothing.",
  },
};

/** Formats elapsed ms as a CD-player style `M:SS:FF` transport counter. */
function formatUptime(elapsedMs: number): string {
  const totalFrames = Math.floor((elapsedMs / 1000) * FRAMES_PER_SECOND);
  const frames = totalFrames % FRAMES_PER_SECOND;
  const totalSeconds = Math.floor(totalFrames / FRAMES_PER_SECOND);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 10;
  return `${minutes}:${String(seconds).padStart(2, "0")}:${String(frames).padStart(2, "0")}`;
}

interface TrustDisplayPanelProps {
  /** True while any rail key is lit, so the display surges with the mesh. */
  readonly active: boolean;
  /**
   * The computer in the WebGL stack whose readout the screen shows
   * (whichever was hovered last; the stage defaults it to "middle").
   */
  readonly tier: DeviceTier;
  /**
   * Stage-local x of the panel's horizontal center, measured by the stage as
   * the midpoint between the centered device's right edge and the stage's
   * right edge. `null` until the first measurement lands (the CSS fallback
   * positions it until then).
   */
  readonly centerX?: number | null;
}

/**
 * Skeuomorphic CD-player-style transport panel on the right side of the
 * WebGL `IsolatedDevice` in the Built for trust section — the counterpart
 * to the `ServiceButtonRail` pinned on the left. Modelled on the reference
 * deck, top to bottom inside one shared three-ring `<Plate />` rim:
 *
 *   1. a recessed disc tray holding a raised beveled MDAT-style chassis: a
 *      set-in rounded window with a slowly spinning data disc (curved spec
 *      text, groove rings, layered hub, metal core) beside an etched
 *      INSERT plate and a recessed logo well,
 *   2. a dark inset screen (the same deep-recess glass recipe as the
 *      integrations device screen in `PersonalAgentSection`) matching the
 *      disc tray's height, with gold mono readouts — agent VM number, a
 *      live ticking uptime counter, a segmented attestation bar, and a
 *      per-computer readout (title + typewriter description) for whichever
 *      computer in the WebGL stack is hovered/active.
 *
 * Purely decorative (`aria-hidden`); the display surges while energy is
 * crossing the mesh (any rail key lit).
 */
export function TrustDisplayPanel({
  active,
  tier,
  centerX,
}: TrustDisplayPanelProps): ReactNode {
  const [elapsedMs, setElapsedMs] = useState(0);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const lit = active;

  // The attestation bar refills one cell per second, then wraps — like a
  // CD player's PLAYING ADDRESS bar marching across the disc.
  const litSegments = Math.floor(elapsedMs / 1000) % (SEGMENT_COUNT + 1);

  const readout = TIER_READOUTS[tier];

  const panelStyle =
    centerX != null
      ? ({ "--trust-panel-center-x": `${centerX}px` } as CSSProperties)
      : undefined;

  return (
    <Plate className="trustDisplayPanel" aria-hidden="true" style={panelStyle}>
      <div className="trustDisplayBezel">
        <div className="trustDiscWell">
          <div className="trustDiscChassis">
            <div className="trustDiscWindow">
              <div className="trustDisc">
                <div className="trustDiscSpinner">
                  <div className="trustDiscFace" />
                  <svg
                    className="trustDiscText"
                    viewBox="0 0 200 200"
                    aria-hidden="true"
                  >
                    <defs>
                      <path
                        id="trustDiscTextPath"
                        d="M 100,100 m -88,0 a 88,88 0 1,1 176,0 a 88,88 0 1,1 -176,0"
                      />
                    </defs>
                    <text className="trustDiscTextRing">
                      <textPath href="#trustDiscTextPath">
                        SANDBOXED VM &#8226; TRUSTED EXECUTION &#8226; ATTESTED
                        BOOT &#8226; CONFIDENTIAL COMPUTE &#8226; ENCRYPTED
                        MEMORY &#8226; ISOLATED RUNTIME &#8226;
                      </textPath>
                    </text>
                  </svg>
                </div>
                <div className="trustDiscHub">
                  <span className="trustDiscCore" />
                </div>
              </div>
            </div>

            <div className="trustDiscSide">
              <div className="trustDiscPlate">
                <span className="trustDiscPlateArrow" />
                <span className="trustDiscPlateText">Insert tokens</span>
              </div>
              <div className="trustDiscLogoWell">
                <span className="trustDiscLogoBadge">
                  <img
                    className="trustDiscLogoMark"
                    src="/AURA_logo_text_mark.png"
                    alt="AURA"
                  />
                </span>
              </div>
            </div>
          </div>
        </div>

        <div
          className="trustDisplayWell"
          data-active={lit ? "true" : undefined}
        >
          <div className="trustDisplayRow">
            <div className="trustDisplayGroup">
              <span className="trustDisplayLabel">VM</span>
              <span className="trustDisplayDigits">03</span>
            </div>
            <div className="trustDisplayGroup trustDisplayGroup--end">
              <span className="trustDisplayLabel">Uptime</span>
              <span className="trustDisplayDigits trustDisplayDigits--uptime">
                {formatUptime(elapsedMs)}
              </span>
            </div>
          </div>

          <div className="trustDisplayGroup">
            <span className="trustDisplayLabel">Attestation</span>
            <div className="trustDisplaySegments">
              {Array.from({ length: SEGMENT_COUNT }, (_, index) => (
                <span
                  key={index}
                  className="trustDisplaySegment"
                  data-lit={index < litSegments ? "true" : undefined}
                />
              ))}
            </div>
          </div>

          {/* Keyed on the tier so switching computers remounts the
              typewriters and the description re-types from scratch. */}
          <div className="trustDisplayReadout" key={tier}>
            <span className="trustDisplayReadoutTitle">{readout.title}</span>
            <p className="trustDisplayReadoutLine">
              <TypewriterText
                text={readout.description}
                speedMs={12}
                showCaret={false}
              />
            </p>
          </div>

          <div className="trustDisplayGloss" />
        </div>
      </div>
    </Plate>
  );
}
