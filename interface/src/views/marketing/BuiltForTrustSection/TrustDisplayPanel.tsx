import { useEffect, useState, type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import "./TrustDisplayPanel.css";

/** CD-transport frame rate the uptime readout counts in (M:SS:FF). */
const FRAMES_PER_SECOND = 75;
/** How often the uptime readout repaints. */
const TICK_MS = 120;
/** Cells in the segmented attestation bar. */
const SEGMENT_COUNT = 14;

const STATUS_FLAGS = ["Attested", "Sealed", "Isolated"] as const;

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
 *      live ticking uptime counter, a segmented attestation bar, and lit
 *      status flags.
 *
 * Purely decorative (`aria-hidden`); the display surges while energy is
 * crossing the mesh (any rail key lit).
 */
export function TrustDisplayPanel({
  active,
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

  return (
    <Plate className="trustDisplayPanel" aria-hidden="true">
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
                        BOOT &#8226; MDLP COMPATIBLE &#8226; ENHANCED &#8226;
                        ISOLATED RUNTIME &#8226;
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
                  <span className="trustDiscLogoMark">AURA</span>
                  <span className="trustDiscLogoSub">Mini data-disc</span>
                </span>
              </div>
            </div>
          </div>
        </div>

        <div
          className="trustDisplayWell"
          data-active={lit ? "true" : undefined}
        >
          <div className="trustDisplayGlow" />

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

          <ul className="trustDisplayFlags">
            {STATUS_FLAGS.map((flag) => (
              <li key={flag} className="trustDisplayFlag">
                <span className="trustDisplayFlagDot" />
                {flag}
              </li>
            ))}
          </ul>

          <div className="trustDisplayGloss" />
        </div>
      </div>
    </Plate>
  );
}
