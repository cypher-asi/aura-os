import { type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import { RAIL_LOGOS } from "./service-rail-logos";
import "./ServiceButtonRail.css";

/**
 * Skeuomorphic vertical rail of physical service buttons that sits at the
 * far left of the WebGL `IsolatedDevice` in the Built for trust section.
 * Each button is a raised keycap (recessed socket + bevelled cap, mirroring
 * the `SkillSeaCard` macro-pad keys) carrying a monochrome service glyph
 * from the shared `SERVICE_LOGOS` set, plus a circular nozzle on the rail's
 * outer (right) border from which the connection mesh fans toward the
 * device.
 *
 * Presentational: the lit set + pulse/auto-cycle live in the parent
 * `TrustDeviceStage` (see `useServicePulse`) so the rail keys and the mesh
 * lines light together. Purely decorative (`aria-hidden`).
 */

interface ServiceButtonRailProps {
  readonly litLogos: ReadonlySet<number>;
  readonly onActivate: (index: number) => void;
}

export function ServiceButtonRail({
  litLogos,
  onActivate,
}: ServiceButtonRailProps): ReactNode {
  return (
    <Plate className="serviceButtonRail" aria-hidden="true">
      <div className="serviceButtonRailWell">
        {RAIL_LOGOS.map((logo, index) => {
          const active = litLogos.has(index);
          return (
            <div key={logo.id} className="serviceButtonSocket">
              <button
                type="button"
                tabIndex={-1}
                className="serviceButtonKey"
                data-active={active ? "true" : undefined}
                aria-label={logo.label}
                title={logo.label}
                onClick={() => onActivate(index)}
              >
                <svg
                  width={22}
                  height={22}
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path d={logo.path} />
                </svg>
              </button>
              <span
                className="serviceButtonNozzle"
                data-rail-nozzle={index}
                data-active={active ? "true" : undefined}
              />
            </div>
          );
        })}
      </div>
    </Plate>
  );
}
