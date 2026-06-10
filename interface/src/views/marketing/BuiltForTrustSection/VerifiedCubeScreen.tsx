import { type ReactNode } from "react";
import { Plate } from "../../../components/Plate";
import "./VerifiedCubeScreen.css";

const FACES = ["front", "back", "right", "left", "top", "bottom"] as const;

/** The six glassy faces of one wireframe cube. */
function CubeFaces(): ReactNode {
  return (
    <>
      {FACES.map((face) => (
        <span
          key={face}
          className={`verifiedCubeFace verifiedCubeFace--${face}`}
        />
      ))}
    </>
  );
}

/**
 * Decorative media for the "Trusted and verifiable." trust card: a
 * rounded-corner screen device in the section's dark machined-metal
 * language (shared three-ring `Plate` rim, recessed near-black glass)
 * displaying a holographic cube nested inside a larger cube — both built
 * from CSS 3D faces with thin iridescent edges, tumbling together in a
 * slow perpetual rotation. Purely decorative, so the stage is
 * `aria-hidden`.
 */
export function VerifiedCubeScreen(): ReactNode {
  return (
    <div className="verifiedCubeStage" aria-hidden="true">
      <Plate radius="26px" className="verifiedCubeShell">
        <div className="verifiedCubeBody">
          <div className="verifiedCubeScreen">
            <span className="verifiedCubeGlow" />
            <div className="verifiedCubeScene">
              <div className="verifiedCubeTilt">
                <div className="verifiedCubeSpin">
                  <div className="verifiedCube verifiedCubeOuter">
                    <CubeFaces />
                  </div>
                  <div className="verifiedCube verifiedCubeInner">
                    <CubeFaces />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Plate>
    </div>
  );
}
