import { type ReactNode } from "react";
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
  return (
    <Plate className="personalAgentDevice" aria-hidden="true">
      <div className="personalAgentDeviceContent">
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

        {hexGrille ? <TerminalScreen /> : null}

        <div className="personalAgentDeviceScreen">
          {hexGrille ? (
            <video
              className="personalAgentDeviceVideo"
              src="/agent-character-rotate.mp4"
              autoPlay
              loop
              muted
              playsInline
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

/**
 * Right-hand side-panel LCD of the hero device: a tall recessed terminal that
 * fills the enlarged right metal panel, rendering a looping mock feed of an
 * agent being created and deployed to the AURA network. The line stack is
 * duplicated so the upward scroll reads as a continuous live log; everything
 * is decorative (`aria-hidden` via the device root).
 */
function TerminalScreen(): ReactNode {
  return (
    <div className="madeForYouTerminalScreen">
      <div className="madeForYouTerminalGloss" />
      <div className="madeForYouTerminalScroll">
        <div className="madeForYouTerminalTrack">
          {[0, 1].map((copy) => (
            <ul key={copy} className="madeForYouTerminalLines">
              {TERMINAL_LINES.map((line, index) => (
                <li
                  key={`${copy}-${index}`}
                  className={
                    line.kind
                      ? `madeForYouTerminalLine madeForYouTerminalLine--${line.kind}`
                      : "madeForYouTerminalLine"
                  }
                >
                  {line.kind === "prompt" ? (
                    <span className="madeForYouTerminalPrompt">$</span>
                  ) : null}
                  {line.text}
                </li>
              ))}
            </ul>
          ))}
        </div>
      </div>
      <div className="madeForYouTerminalCaret">
        <span className="madeForYouTerminalPrompt">$</span>
        <span className="madeForYouTerminalCursor" />
      </div>
    </div>
  );
}
