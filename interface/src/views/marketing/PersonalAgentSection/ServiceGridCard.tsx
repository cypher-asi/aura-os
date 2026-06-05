import { type ReactNode } from "react";
import { SERVICE_LOGOS } from "./brand-logos";

/**
 * Mini-UI for the "Designed for you" quadrant: a grid of grayscale
 * brand tiles for the popular services AURA connects to. Mirrors the
 * dark bordered-tile treatment of the marketing reference — each tile
 * is a hairline-bordered square holding one monochrome brand mark
 * (painted in `currentColor` so the tile owns the tint).
 */
export function ServiceGridCard(): ReactNode {
  return (
    <div className="personalAgentServiceGrid" aria-hidden="true">
      {SERVICE_LOGOS.map((logo) => (
        <div key={logo.id} className="personalAgentServiceTile">
          <svg
            width={28}
            height={28}
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
  );
}
