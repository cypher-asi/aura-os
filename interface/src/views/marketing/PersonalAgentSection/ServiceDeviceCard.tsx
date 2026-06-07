import { type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import { SERVICE_LOGOS } from "./brand-logos";

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
        <div className="personalAgentDeviceScreen">
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
