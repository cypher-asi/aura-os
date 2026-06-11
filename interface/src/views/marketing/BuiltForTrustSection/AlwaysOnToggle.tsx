import { useState, type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import "./AlwaysOnToggle.css";

/**
 * Media for the "Always on." trust card: a skeuomorphic toggle switch in
 * the site's dark machined-metal language. Recessed pill socket sunk into
 * the card panel, the shared three-ring `Plate` rim as the metallic bezel,
 * a near-black inner track, and inside it a raised silver knob with
 * gold-glowing "ON" lettering on the open side — the glow slowly breathes
 * but never switches off.
 *
 * The switch is clickable: each click slides the knob to the other side
 * (the "ON" label flips to the now-open side), but it is still lit — the
 * point is that it is "always on" no matter what you click. The knob
 * starts on the left with "ON" on the right.
 */
export function AlwaysOnToggle(): ReactNode {
  const [side, setSide] = useState<"left" | "right">("left");
  return (
    <div className="alwaysOnStage">
      <button
        type="button"
        className="alwaysOnSocket"
        aria-label="Always on"
        onClick={() => setSide((s) => (s === "left" ? "right" : "left"))}
      >
        <Plate radius="999px" className="alwaysOnShell">
          <div className="alwaysOnTrack" data-side={side}>
            <span className="alwaysOnKnob" aria-hidden="true" />
            <span className="alwaysOnLabel" aria-hidden="true">
              ON
            </span>
          </div>
        </Plate>
      </button>
    </div>
  );
}
