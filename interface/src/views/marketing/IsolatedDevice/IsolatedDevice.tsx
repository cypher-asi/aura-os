import { useEffect, useRef, type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import { DeviceScreen } from "../../../components/DeviceScreen";
import {
  createIsolatedDeviceScene,
  isWebGLAvailable,
} from "./isolated-device-scene";
import "./IsolatedDevice.css";

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
 * The device is decorative hardware fiction, so the host is `aria-hidden`
 * and nothing renders if WebGL is unavailable.
 */
export function IsolatedDevice(): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !isWebGLAvailable()) {
      return;
    }
    const scene = createIsolatedDeviceScene(host);
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
