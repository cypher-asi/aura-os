import { useRef, type ReactNode } from "react";
import { IsolatedDevice } from "../IsolatedDevice/IsolatedDevice";
import { ServiceButtonRail } from "./ServiceButtonRail";
import { ServiceConnectionField } from "./ServiceConnectionField";
import { TrustDisplayPanel } from "./TrustDisplayPanel";
import { RAIL_LOGOS } from "./service-rail-logos";
import { useServicePulse } from "./useServicePulse";
import "./TrustDeviceStage.css";

/**
 * Composes the Built for trust device card's media well: the skeuomorphic
 * `ServiceButtonRail` pinned far-left, the centered WebGL `IsolatedDevice`,
 * a single converging port on the device's left edge, the
 * `ServiceConnectionField` SVG that routes every rail line into that port,
 * and the `TrustDisplayPanel` VFD readout pinned far-right at the rail's
 * exact height. Owns the shared lit state (`useServicePulse`) so a lit rail
 * key also surges the energy flowing down its connection line and brightens
 * the display glass.
 */
export function TrustDeviceStage(): ReactNode {
  const stageRef = useRef<HTMLDivElement>(null);
  const { litLogos, activate } = useServicePulse(RAIL_LOGOS.length);

  return (
    <div className="builtForTrustStage" ref={stageRef}>
      <ServiceConnectionField stageRef={stageRef} litLogos={litLogos} />

      <ServiceButtonRail litLogos={litLogos} onActivate={activate} />

      <div className="builtForTrustDeviceWrap">
        <IsolatedDevice />
        <span
          className="trustDevicePort"
          data-device-port
          data-active={litLogos.size > 0 ? "true" : undefined}
          aria-hidden="true"
        />
      </div>

      <TrustDisplayPanel active={litLogos.size > 0} />
    </div>
  );
}
