import { useRef, type ReactNode } from "react";
import { IsolatedDevice } from "../IsolatedDevice/IsolatedDevice";
import { ServiceButtonRail } from "./ServiceButtonRail";
import { ServiceConnectionField } from "./ServiceConnectionField";
import { RAIL_LOGOS } from "./service-rail-logos";
import { useServicePulse } from "./useServicePulse";
import "./TrustDeviceStage.css";

/**
 * Composes the Built for trust device card's media well: the skeuomorphic
 * `ServiceButtonRail` pinned far-left, the centered WebGL `IsolatedDevice`,
 * a column of nozzles down the device's left edge, and the
 * `ServiceConnectionField` SVG mesh wiring the two together. Owns the shared
 * lit state (`useServicePulse`) so a lit rail key also lights every mesh
 * line leaving it.
 */

/** Nozzles down the device's left edge that the mesh fans into. */
const DEVICE_NOZZLE_COUNT = 16;

export function TrustDeviceStage(): ReactNode {
  const stageRef = useRef<HTMLDivElement>(null);
  const { litLogos, activate } = useServicePulse(RAIL_LOGOS.length);

  return (
    <div className="builtForTrustStage" ref={stageRef}>
      <ServiceConnectionField
        stageRef={stageRef}
        litLogos={litLogos}
        deviceNozzleCount={DEVICE_NOZZLE_COUNT}
      />

      <ServiceButtonRail litLogos={litLogos} onActivate={activate} />

      <div className="builtForTrustDeviceWrap">
        <IsolatedDevice />
        <div className="trustDeviceNozzleColumn" aria-hidden="true">
          {Array.from({ length: DEVICE_NOZZLE_COUNT }, (_, j) => (
            <span
              key={j}
              className="trustDeviceNozzle"
              data-device-nozzle={j}
              style={{ top: `${((j + 0.5) / DEVICE_NOZZLE_COUNT) * 100}%` }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
