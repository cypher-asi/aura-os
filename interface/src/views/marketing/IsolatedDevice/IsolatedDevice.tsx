import { useEffect, useRef, type ReactNode } from "react";
import {
  createIsolatedDeviceScene,
  isWebGLAvailable,
} from "./isolated-device-scene";
import "./IsolatedDevice.css";

/**
 * Marketing "isolated device" — a WebGL-rendered, diagonally-viewed
 * Mac-mini-style computer centered in the "Isolated by default." trust card,
 * modelled after the reference render: a squircle-footprint case with a
 * rounded-over lid edge, a recessed top plate with four corner screws and a
 * centered embossed logo, louver banks on the walls, and an inset base
 * plinth — finished in the site's dark matte metal rather than the photo's
 * bright silver.
 *
 * The device is decorative hardware fiction, so the host is `aria-hidden`
 * and nothing renders if WebGL is unavailable. The scene idles with a gentle
 * sway and leans toward the pointer; `prefers-reduced-motion` collapses it
 * to a single static frame.
 */
export function IsolatedDevice(): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !isWebGLAvailable()) {
      return;
    }
    const reducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const scene = createIsolatedDeviceScene(host, { reducedMotion });
    return () => scene.dispose();
  }, []);

  return <div className="isolatedDevice" aria-hidden="true" ref={hostRef} />;
}
