import { useEffect, useRef, type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import { DeviceScreen } from "../../../components/DeviceScreen";
import {
  createIsolatedDeviceScene,
  isWebGLAvailable,
  type DeviceTier,
} from "./isolated-device-scene";
import "./IsolatedDevice.css";

interface IsolatedDeviceProps {
  /**
   * Fires when the pointer moves over a different computer in the stack
   * (top ghost, solid middle device, bottom ghost), or off the canvas
   * (`null`). Drives the Built for trust display panel's readout.
   */
  readonly onHoverChange?: (tier: DeviceTier | null) => void;
}

/**
 * Marketing "isolated device" — a WebGL-rendered Mac-mini-style computer
 * centered in the "Isolated by default." trust card, modelled after the
 * reference render: a squircle-footprint case with a rounded-over lid edge,
 * a recessed top screen streaming the first section's console plasma
 * animation, louver banks on the walls, and an inset base plinth — finished in the site's
 * dark matte metal rather than the photo's bright silver. It is locked in
 * a centered perfect-diamond pose viewed from a high angle; the motion is
 * the plasma plus a strip of status LEDs above the front louver bank
 * beeping in sequence — always looping, like the hero console's ambient
 * readout it mirrors.
 *
 * The scene is mounted in the shared marketing device kit — a `<Plate />`
 * panel with a recessed `<DeviceScreen />` well — so it sits inset into the
 * page like every other element holder (matching the hero `AgentConsole`).
 *
 * Hovering a computer in the stack (top ghost / solid middle / bottom
 * ghost) fades in a slight gold glow on that computer and reports the tier
 * via `onHoverChange`, which the trust section uses to swap the display
 * panel's readout.
 *
 * The device is decorative hardware fiction, so the host is `aria-hidden`
 * and nothing renders if WebGL is unavailable.
 */
export function IsolatedDevice({
  onHoverChange,
}: IsolatedDeviceProps = {}): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null);
  // Kept in a ref so a new callback identity never remounts the scene.
  const onHoverChangeRef = useRef(onHoverChange);
  useEffect(() => {
    onHoverChangeRef.current = onHoverChange;
  }, [onHoverChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !isWebGLAvailable()) {
      return;
    }
    const scene = createIsolatedDeviceScene(host, {
      onHoverChange: (tier) => onHoverChangeRef.current?.(tier),
    });
    return () => scene.dispose();
  }, []);

  return (
    <Plate radius="38px" className="isolatedDevicePlate">
      <DeviceScreen className="isolatedDeviceScreen">
        <div className="isolatedDevice" aria-hidden="true" ref={hostRef} />
      </DeviceScreen>
    </Plate>
  );
}
