import { useEffect, useRef, useState, type ReactNode } from "react";
import { MessageCircle, Send } from "lucide-react";
import "./ConnectedConsoleDevice.css";

/**
 * Multi-subpath OUTLINE (stroke) glyphs for the brand keys, in the same
 * lucide outline style (24x24 viewBox, `fill: none`, `stroke: currentColor`)
 * as the iMessage bubble and Telegram paper-plane, so every key reads as a
 * line icon rather than a filled silhouette. Paths are the CC0 Tabler-icons
 * `brand-slack` / `brand-discord` outlines, kept inline so the marketing page
 * pulls in no extra icon dependency.
 */
const SLACK_OUTLINE_PATHS: readonly string[] = [
  "M12 12v-6a2 2 0 0 1 4 0v6m0 -2a2 2 0 1 1 2 2h-6",
  "M12 12h6a2 2 0 0 1 0 4h-6m2 0a2 2 0 1 1 -2 2v-6",
  "M12 12v6a2 2 0 0 1 -4 0v-6m0 2a2 2 0 1 1 -2 -2h6",
  "M12 12h-6a2 2 0 0 1 0 -4h6m-2 0a2 2 0 1 1 2 -2v6",
];

const DISCORD_OUTLINE_PATHS: readonly string[] = [
  "M8 12a1 1 0 1 0 2 0a1 1 0 0 0 -2 0",
  "M14 12a1 1 0 1 0 2 0a1 1 0 0 0 -2 0",
  "M15.5 17c0 1 1.5 3 2 3c1.5 0 2.833 -1.667 3.5 -3c.667 -1.667 .5 -5.833 -1.5 -11.5c-1.457 -1.015 -3 -1.34 -4.5 -1.5l-.972 1.923a11.913 11.913 0 0 0 -4.053 0l-.975 -1.923c-1.5 .16 -3.043 .485 -4.5 1.5c-2 5.667 -2.167 9.833 -1.5 11.5c.667 1.333 2 3 3.5 3c.5 0 2 -2 2 -3",
  "M7 16.5c3.5 1 6.5 1 10 0",
];

/**
 * A single channel key in the bottom tray. `mark` is either an outline brand
 * glyph (a set of `currentColor` stroke subpaths in a 24x24 viewBox), a lucide
 * icon component (the outline glyphs for the iMessage bubble and Telegram
 * paper-plane), or `"zero"` — the lit orange ZERO wordmark. No ZERO image
 * asset exists in the repo, so it is painted as styled text faithful to the
 * reference; swapping in an `<img>` later is a one-line change.
 */
type ChannelMark =
  | { readonly kind: "outline"; readonly paths: readonly string[] }
  | { readonly kind: "icon"; readonly Icon: typeof MessageCircle }
  | { readonly kind: "zero" };

interface Channel {
  readonly id: string;
  readonly label: string;
  readonly mark: ChannelMark;
}

const CHANNELS: readonly Channel[] = [
  { id: "imessage", label: "iMessage", mark: { kind: "icon", Icon: MessageCircle } },
  { id: "slack", label: "Slack", mark: { kind: "outline", paths: SLACK_OUTLINE_PATHS } },
  { id: "telegram", label: "Telegram", mark: { kind: "icon", Icon: Send } },
  { id: "discord", label: "Discord", mark: { kind: "outline", paths: DISCORD_OUTLINE_PATHS } },
  { id: "zero", label: "ZERO", mark: { kind: "zero" } },
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
 * edge). Below it a recessed tray carries five gray matte keys for the
 * messaging channels AURA plugs into: iMessage, Slack, Telegram, Discord,
 * and the lit ZERO key.
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
  // Which channel key is currently "pressed" (selected). The ZERO key is the
  // active channel by default; clicking any other key presses it instead.
  const [pressedChannel, setPressedChannel] = useState<string>("zero");

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
            {CHANNELS.map((channel) => (
              <button
                key={channel.id}
                type="button"
                className={
                  channel.mark.kind === "zero"
                    ? "consoleKey consoleKey--zero"
                    : "consoleKey"
                }
                aria-label={channel.label}
                aria-pressed={pressedChannel === channel.id}
                data-pressed={pressedChannel === channel.id ? "true" : undefined}
                onClick={() => setPressedChannel(channel.id)}
              >
                {channel.mark.kind === "zero" ? (
                  <span className="consoleKeyZero">ZERO</span>
                ) : channel.mark.kind === "icon" ? (
                  <channel.mark.Icon
                    className="consoleKeyMark"
                    size={26}
                    strokeWidth={1.75}
                    aria-hidden="true"
                  />
                ) : (
                  <svg
                    className="consoleKeyMark"
                    width={24}
                    height={24}
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    {channel.mark.paths.map((d) => (
                      <path key={d} d={d} />
                    ))}
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
