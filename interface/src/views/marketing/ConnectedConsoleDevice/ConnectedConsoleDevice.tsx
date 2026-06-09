import { type ReactNode } from "react";
import { MessageCircle, Send } from "lucide-react";
import { SERVICE_LOGOS } from "../PersonalAgentSection/brand-logos";
import "./ConnectedConsoleDevice.css";

/**
 * Pull the single-path brand marks (24x24, `currentColor`) reused for the
 * tray keys out of the shared `SERVICE_LOGOS` set so the channel buttons
 * track the same CC0 simple-icons glyphs the rest of the marketing page
 * uses, without re-declaring the path data here.
 */
const BRAND_PATHS: Record<string, string> = Object.fromEntries(
  SERVICE_LOGOS.map((logo) => [logo.id, logo.path]),
);

/**
 * A single channel key in the bottom tray. `mark` is either a brand SVG
 * path string (rendered in a 24x24 `currentColor` viewBox), a lucide icon
 * component (for the outline glyphs that match the reference's iMessage
 * bubble and Telegram paper-plane), or `"zero"` — the lit orange ZERO
 * wordmark. No ZERO image asset exists in the repo, so it is painted as
 * styled text faithful to the reference; swapping in an `<img>` later is a
 * one-line change.
 */
type ChannelMark =
  | { readonly kind: "path"; readonly path: string }
  | { readonly kind: "icon"; readonly Icon: typeof MessageCircle }
  | { readonly kind: "zero" };

interface Channel {
  readonly id: string;
  readonly label: string;
  readonly mark: ChannelMark;
}

const CHANNELS: readonly Channel[] = [
  { id: "imessage", label: "iMessage", mark: { kind: "icon", Icon: MessageCircle } },
  { id: "slack", label: "Slack", mark: { kind: "path", path: BRAND_PATHS.slack } },
  { id: "telegram", label: "Telegram", mark: { kind: "icon", Icon: Send } },
  { id: "discord", label: "Discord", mark: { kind: "path", path: BRAND_PATHS.discord } },
  { id: "zero", label: "ZERO", mark: { kind: "zero" } },
];

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
              <div className="consoleKnobDial">
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
                tabIndex={-1}
                className={
                  channel.mark.kind === "zero"
                    ? "consoleKey consoleKey--zero"
                    : "consoleKey"
                }
                aria-label={channel.label}
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
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d={channel.mark.path} />
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
