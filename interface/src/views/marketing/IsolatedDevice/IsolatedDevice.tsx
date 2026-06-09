import { useEffect, useRef, type ReactNode } from "react";
import {
  createIsolatedDeviceScene,
  isWebGLAvailable,
} from "./isolated-device-scene";
import "./IsolatedDevice.css";

/**
 * Marketing "isolated device" — a WebGL-rendered Mac-mini-style computer
 * centered in the "Isolated by default." trust card, modelled after the
 * reference render: a squircle-footprint case with a rounded-over lid edge,
 * a recessed glass top panel (with the first section's console plasma
 * animation streaming on a screen beneath it) held by four corner screws, louver
 * banks on the walls, and an inset base plinth — finished in the site's
 * dark matte metal rather than the photo's bright silver. It is locked in
 * a centered perfect-diamond pose viewed from a high angle; the motion is
 * the orb plus a strip of status LEDs above the front louver bank beeping
 * in sequence (both frozen under reduced motion).
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

  return <div className="isolatedDevice" aria-hidden="true" ref={hostRef} />;
}
