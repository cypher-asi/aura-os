import { useEffect, useRef, useState, type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import { DeviceScreen } from "../../../components/DeviceScreen";
import { useAuraCapabilities } from "../../../hooks/use-aura-capabilities";
import { observeSceneActivity } from "../scene-activity";
import {
  createIsolatedDeviceScene,
  isWebGLAvailable,
  type DeviceTier,
  type IsolatedDeviceScene,
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
 * ghost) fades in a soft white glow on that computer (spilling out from
 * under the solid middle device) and reports the tier via `onHoverChange`,
 * which the trust section uses to swap the display panel's readout.
 *
 * The device is decorative hardware fiction, so the host is `aria-hidden`
 * and nothing renders if WebGL is unavailable.
 */
export function IsolatedDevice({
  onHoverChange,
}: IsolatedDeviceProps = {}): ReactNode {
  const hostRef = useRef<HTMLDivElement>(null);
  // The WebGL scene is heavy; only run it on large (non-mobile) screens. The
  // device frame (Plate + DeviceScreen well) still renders on mobile.
  const { isMobileLayout } = useAuraCapabilities();
  // Drives the entrance fade: stays false until the scene reports its first
  // frame is rendered, so the device eases in when ready instead of popping
  // in as a freshly-baked canvas (mirrors the hero AuraScreenOrb).
  const [ready, setReady] = useState(false);
  // Kept in a ref so a new callback identity never remounts the scene.
  const onHoverChangeRef = useRef(onHoverChange);
  useEffect(() => {
    onHoverChangeRef.current = onHoverChange;
  }, [onHoverChange]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || isMobileLayout || !isWebGLAvailable()) {
      return;
    }
    // The scene is expensive to build (PMREM environment bake, procedural
    // textures, provider-logo rasterization), so creation is deferred
    // until the card first approaches the viewport; afterwards the same
    // activity signal starts/stops its render loop so it never burns GPU
    // offscreen or in a hidden tab.
    let scene: IsolatedDeviceScene | null = null;
    const detachActivity = observeSceneActivity(
      host,
      (active) => {
        if (active && !scene) {
          scene = createIsolatedDeviceScene(host, {
            onHoverChange: (tier) => onHoverChangeRef.current?.(tier),
            onReady: () => setReady(true),
          });
        }
        scene?.setActive(active);
      },
      { rootMargin: "240px" },
    );
    return () => {
      detachActivity();
      scene?.dispose();
      // Re-arm the entrance fade if the effect re-runs.
      setReady(false);
    };
  }, [isMobileLayout]);

  return (
    <Plate radius="38px" className="isolatedDevicePlate">
      <DeviceScreen className="isolatedDeviceScreen">
        <div
          className="isolatedDevice"
          aria-hidden="true"
          ref={hostRef}
          style={{
            opacity: ready ? 1 : 0,
            transition: "opacity 600ms ease-out",
          }}
        />
      </DeviceScreen>
    </Plate>
  );
}
