import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Plate } from "../../../components/Plate";
import "./TrustDisplayPanel.css";

/** CD-transport frame rate the uptime readout counts in (M:SS:FF). */
const FRAMES_PER_SECOND = 75;
/** How often the uptime readout repaints. */
const TICK_MS = 120;
/** Cells in the segmented attestation bar. */
const SEGMENT_COUNT = 14;
/** How long a transport key press holds the display surge. */
const PRESS_PULSE_MS = 1500;

const STATUS_FLAGS = ["Attested", "Sealed", "Isolated"] as const;

/** Round transport keys under the LCD, like a CD player's cue buttons. */
const TRANSPORT_KEYS = [
  { id: "attest", label: "Attest" },
  { id: "verify", label: "Verify" },
] as const;

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
 *   1. a recessed disc tray with a slowly spinning iridescent disc under a
 *      pill-shaped clamp bar,
 *   2. a dark inset VFD glass (the recessed-LCD recipe from `PhoneShell`)
 *      with gold mono readouts — agent VM number, a live ticking uptime
 *      counter, a segmented attestation bar, and lit status flags,
 *   3. a row of round cream transport keys (plus a small dark reseal key).
 *
 * Sized to exactly the rail's height via the shared `--trust-rail-*`
 * custom properties on `.builtForTrustStage`, but wider. Purely decorative
 * (`aria-hidden`); the display surges when energy crosses the mesh (any
 * rail key lit) or when a transport key is pressed.
 */
export function TrustDisplayPanel({
  active,
}: TrustDisplayPanelProps): ReactNode {
  const [elapsedMs, setElapsedMs] = useState(0);
  const [pressLit, setPressLit] = useState(false);
  const pressTimerRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const pressKey = useCallback(() => {
    setPressLit(true);
    if (pressTimerRef.current !== undefined) {
      window.clearTimeout(pressTimerRef.current);
    }
    pressTimerRef.current = window.setTimeout(() => {
      setPressLit(false);
    }, PRESS_PULSE_MS);
  }, []);

  useEffect(() => {
    return () => {
      if (pressTimerRef.current !== undefined) {
        window.clearTimeout(pressTimerRef.current);
      }
    };
  }, []);

  const lit = active || pressLit;

  // The attestation bar refills one cell per second, then wraps — like a
  // CD player's PLAYING ADDRESS bar marching across the disc.
  const litSegments = Math.floor(elapsedMs / 1000) % (SEGMENT_COUNT + 1);

  return (
    <Plate className="trustDisplayPanel" aria-hidden="true">
      <div className="trustDisplayBezel">
        <div className="trustDiscWell">
          <div className="trustDisc">
            <div className="trustDiscFace" />
            <div className="trustDiscHub" />
          </div>
          <div className="trustDiscClamp" />
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

        <div className="trustTransportKeys">
          {TRANSPORT_KEYS.map((key) => (
            <button
              key={key.id}
              type="button"
              tabIndex={-1}
              className="trustTransportKey"
              onClick={pressKey}
            >
              <span className="trustTransportKeyCap" />
              <span className="trustTransportKeyLabel">{key.label}</span>
            </button>
          ))}
          <button
            type="button"
            tabIndex={-1}
            className="trustTransportKey trustTransportKey--small"
            onClick={pressKey}
          >
            <span className="trustTransportKeyCap" />
            <span className="trustTransportKeyLabel">Reseal</span>
          </button>
        </div>
      </div>
    </Plate>
  );
}
