import { type ReactNode } from "react";
import { MessageCircle, Send } from "lucide-react";
import { Section } from "../Section";
import { SERVICE_LOGOS } from "../PersonalAgentSection/brand-logos";
import "./ConnectedConsoleSection.css";

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

/**
 * Marketing "connected console" — a pure-CSS hardware device that sits
 * after the standing-phones section, reading as the hub the visitor's
 * agents speak through. A gray cord with an orange metal tip descends from
 * the centered hero phone above into a brushed-metal speaker panel (large
 * dot-matrix grille, a "MIX" knob, and an orange slider tab on the right
 * edge). Below it a recessed tray carries five gray matte keys for the
 * messaging channels AURA plugs into: iMessage, Slack, Telegram, Discord,
 * and the lit ZERO key.
 *
 * The whole device is decorative hardware fiction. The panel/cord/knob are
 * `aria-hidden`; the channel keys expose their service name via
 * `aria-label` so assistive tech still reads the connected channels. Sizing
 * is `clamp()`-driven with the device in a `container-type: inline-size`
 * context, so the internal hardware scales in `cqw` like the `PhoneShell`.
 */
export function ConnectedConsoleSection(): ReactNode {
  return (
    <Section
      ariaLabel="Connected to iMessage, Slack, Telegram, Discord, and ZERO"
      fullHeight={false}
      className="connectedConsoleSection"
    >
      <div className="connectedConsole">
        <div className="consoleCord" aria-hidden="true">
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

            <div className="consoleGrille" />

            <span className="consoleSlider" />
          </div>

          <div className="consoleTray">
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
    </Section>
  );
}
