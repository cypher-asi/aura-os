import { type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import "./AlwaysOnToggle.css";

/**
 * Decorative media for the "Always on." trust card: a skeuomorphic toggle
 * switch permanently latched ON, rendered in the site's dark machined-metal
 * language. Recessed pill socket sunk into the card panel, the shared
 * three-ring `Plate` rim as the metallic bezel, a near-black inner track,
 * and inside it a raised silver knob on the left with glowing teal "ON"
 * lettering on the right — the glow slowly breathes but never switches off.
 * Purely decorative, so the whole stage is `aria-hidden`.
 */
export function AlwaysOnToggle(): ReactNode {
  return (
    <div className="alwaysOnStage" aria-hidden="true">
      <div className="alwaysOnSocket">
        <Plate radius="999px" className="alwaysOnShell">
          <div className="alwaysOnTrack">
            <span className="alwaysOnKnob" />
            <span className="alwaysOnLabel">ON</span>
          </div>
        </Plate>
      </div>
    </div>
  );
}
