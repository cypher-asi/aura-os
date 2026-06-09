import { useEffect, useRef, useState, type ReactNode } from "react";
import "./ConnectedConsoleDevice.css";

/**
 * A single text key in the bottom tray. Each key is a raised neomorphic
 * keycap (styled after the "Intelligent in all domains" skill keys) carrying
 * a short slang label; `lit` keys rest in the golden accent fill.
 */
interface ConsoleKey {
  readonly id: string;
  readonly label: string;
  readonly lit?: boolean;
}

const CONSOLE_KEYS: readonly ConsoleKey[] = [
  { id: "cook", label: "COOK", lit: true },
  { id: "send-it", label: "SEND IT" },
  { id: "no-cap", label: "NO CAP" },
  { id: "yolo", label: "YOLO", lit: true },
  { id: "for-the-plot", label: "FOR THE PLOT" },
];

/**
 * Resting direction of the MIX knob's indicator, in degrees (0 = right,
 * -90 = up, matching `Math.atan2` screen coords). The indicator sits at the
 * dial's top pointing straight up, so this is subtracted from the cursor angle
 * to land the indicator tip on the pointer rather than the dial's 0deg axis.
 */
const KNOB_REST_ANGLE = -90;

/** Radius of each drilled speaker hole, in the grille's 0-100 viewBox. */
const GRILLE_HOLE_RADIUS = 1.7;

/**
 * Speaker-hole positions for the grille, laid out as a HEXAGONAL
 * close-packed grid clipped to a circle. Hex packing (alternate rows
 * offset by half the spacing, rows spaced by `spacing * sqrt(3)/2`) gives
 * a uniform, coherent mesh that fills the disc edge-to-edge — unlike a
 * polar/ring layout, which leaves visible radial spokes and uneven gaps.
 * Computed once at module load over a 0-100 viewBox so it scales with the
 * `<svg>`; the holes are painted directly onto the metal panel.
 */
const GRILLE_HOLES: ReadonlyArray<{ readonly cx: number; readonly cy: number }> =
  (() => {
    const holes: Array<{ cx: number; cy: number }> = [];
    const spacing = 4.3;
    const rowHeight = (spacing * Math.sqrt(3)) / 2;
    const maxRadius = 47;
    const limit = maxRadius - GRILLE_HOLE_RADIUS;
    const rows = Math.ceil(maxRadius / rowHeight);
    const cols = Math.ceil(maxRadius / spacing) + 1;
    for (let row = -rows; row <= rows; row += 1) {
      const cy = 50 + row * rowHeight;
      const xOffset = row % 2 === 0 ? 0 : spacing / 2;
      for (let col = -cols; col <= cols; col += 1) {
        const cx = 50 + col * spacing + xOffset;
        const dx = cx - 50;
        const dy = cy - 50;
        if (Math.sqrt(dx * dx + dy * dy) <= limit) {
          holes.push({ cx, cy });
        }
      }
    }
    return holes;
  })();

/**
 * Marketing "connected console" — a pure-CSS hardware device that hangs
 * directly beneath the standing phones, reading as the hub the visitor's
 * agents speak through. A gray cord with an orange metal tip descends from
 * the centered hero phone above into a brushed-metal speaker panel (large
 * dot-matrix grille, a "MIX" knob, and an orange slider tab on the right
 * edge). Below it a recessed tray carries five raised keycaps (styled after
 * the "Intelligent in all domains" skill keys) labelled with short slang
 * commands, a couple lit in the golden accent.
 *
 * Designed to be embedded in a flex column (e.g. `AgentChatSection`'s media
 * well, beneath the phones and above the card's writing block) so the copy
 * reads below the device. The whole device is decorative hardware fiction:
 * the panel/cord/knob are `aria-hidden`; the channel keys expose their
 * service name via `aria-label` so assistive tech still reads the connected
 * channels. Sizing is `clamp()`-driven with the device in a
 * `container-type: inline-size` context, so the internal hardware scales in
 * `cqw` like the `PhoneShell`.
 */
export function ConnectedConsoleDevice(): ReactNode {
  const knobDialRef = useRef<HTMLDivElement>(null);
  // Which key is currently "pressed" (selected). The first key is active by
  // default; clicking any other key presses it instead.
  const [pressedKey, setPressedKey] = useState<string>(CONSOLE_KEYS[0].id);

  // MIX knob follows the cursor: on any mouse movement, rotate the brushed-
  // metal dial so its glowing indicator aims at the pointer. Updates are
  // coalesced to one per animation frame; the dial center is re-read each frame
  // so it stays correct as the page scrolls. `KNOB_REST_ANGLE` (straight up) is
  // subtracted so the indicator tip, not the dial's 0deg, points at the cursor.
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let frame = 0;
    let pointerX = 0;
    let pointerY = 0;
    // Accumulated rotation (degrees). We unwrap the raw -180..180 angle into a
    // continuous value so crossing the +/-180 seam advances by the shortest
    // signed delta, and the eased transition never spins the long way around.
    let currentRotation = 0;

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
      const target = deg - KNOB_REST_ANGLE;
      const delta = ((target - currentRotation) % 360 + 540) % 360 - 180;
      currentRotation += delta;
      dial.style.transform = `rotate(${currentRotation}deg)`;
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
  }, []);

  return (
    <div className="connectedConsole">
      <div className="consoleCord" aria-hidden="true">
        <span className="consoleCordBase" />
        <span className="consoleCordTip" />
      </div>

      <div className="consoleStack">
        <div className="consoleBody" aria-hidden="true">
          <div className="consoleKnobBay">
            <div className="consoleKnob">
              <div className="consoleKnobDial" ref={knobDialRef}>
                <span className="consoleKnobIndicator" />
              </div>
            </div>
            <span className="consoleKnobLabel">MIX</span>
          </div>

          <svg
            className="consoleGrille"
            viewBox="0 0 100 100"
            aria-hidden="true"
          >
            {GRILLE_HOLES.map((hole, index) => (
              <circle
                key={index}
                cx={hole.cx}
                cy={hole.cy}
                r={GRILLE_HOLE_RADIUS}
              />
            ))}
          </svg>

          <span className="consoleSlider" />
        </div>

        <div className="consoleTray">
          <div className="consoleTrayWell">
            {CONSOLE_KEYS.map((consoleKey) => (
              <div key={consoleKey.id} className="consoleKeySocket">
                <button
                  type="button"
                  className="consoleKey"
                  aria-label={consoleKey.label}
                  aria-pressed={pressedKey === consoleKey.id}
                  data-lit={consoleKey.lit ? "true" : undefined}
                  data-pressed={pressedKey === consoleKey.id ? "true" : undefined}
                  onClick={() => setPressedKey(consoleKey.id)}
                >
                  <span className="consoleKeyLabel">{consoleKey.label}</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
