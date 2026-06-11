import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { IsolatedDevice } from "../IsolatedDevice/IsolatedDevice";
import type { DeviceTier } from "../IsolatedDevice/isolated-device-scene";
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
 *
 * Also owns the hovered-computer state: mousing over a computer in the
 * WebGL stack glows it and swaps the display panel's readout to that
 * tier's copy. The selection is sticky — leaving the canvas keeps the last
 * hovered tier active (defaulting to the solid middle device) so the
 * screen always shows a readout.
 */
export function TrustDeviceStage(): ReactNode {
  const stageRef = useRef<HTMLDivElement>(null);
  const deviceWrapRef = useRef<HTMLDivElement>(null);
  const { litLogos, activate } = useServicePulse(RAIL_LOGOS.length);
  const [activeTier, setActiveTier] = useState<DeviceTier>("middle");
  const [panelCenterX, setPanelCenterX] = useState<number | null>(null);

  const handleHoverChange = useCallback((tier: DeviceTier | null) => {
    if (tier !== null) {
      setActiveTier(tier);
    }
  }, []);

  // Center the display panel in the gap between the centered device's right
  // edge and the stage's right edge. Measured from the live DOM (mirroring
  // ServiceConnectionField) so it tracks the responsive device width and the
  // WebGL canvas settling, rather than hard-coding the clamp geometry.
  const measure = useCallback(() => {
    const stage = stageRef.current;
    const device = deviceWrapRef.current;
    if (!stage || !device) {
      return;
    }
    const stageRect = stage.getBoundingClientRect();
    const deviceRect = device.getBoundingClientRect();
    const deviceRight = deviceRect.right - stageRect.left;
    setPanelCenterX((deviceRight + stageRect.width) / 2);
  }, []);

  useLayoutEffect(() => {
    measure();
    const raf = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(raf);
  }, [measure]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    window.addEventListener("resize", measure);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [measure]);

  return (
    <div className="builtForTrustStage" ref={stageRef}>
      <ServiceConnectionField stageRef={stageRef} litLogos={litLogos} />

      <ServiceButtonRail litLogos={litLogos} onActivate={activate} />

      <div className="builtForTrustDeviceWrap" ref={deviceWrapRef}>
        <IsolatedDevice onHoverChange={handleHoverChange} />
        <span
          className="trustDevicePort"
          data-device-port
          data-active={litLogos.size > 0 ? "true" : undefined}
          aria-hidden="true"
        />
      </div>

      <TrustDisplayPanel
        active={litLogos.size > 0}
        tier={activeTier}
        centerX={panelCenterX}
      />
    </div>
  );
}
