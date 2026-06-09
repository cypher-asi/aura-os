import { type ReactNode } from "react";
import "./IsolatedDevice.css";

/**
 * Marketing "isolated device" — a pure-CSS, diagonally-viewed Mac-mini-style
 * computer that sits centered in the "Isolated by default." trust card. It is
 * a genuine CSS 3D cuboid (`transform-style: preserve-3d`) rotated into an
 * isometric pose so it reads as a small sealed appliance: a brushed lid with a
 * recessed inner seam, four corner screws, and a faintly etched center mark,
 * over two visible case faces carrying louvered vents (a larger bank low on
 * the front-left face, a smaller one on the right face), matching the
 * reference render.
 *
 * The whole device is decorative hardware fiction, so the scene is
 * `aria-hidden`. It is recolored to the same dark-metal gradient family as the
 * `ConnectedConsoleDevice` speaker panel rather than the photo's bright
 * silver. Internals are sized in `cqw` within a `container-type: inline-size`
 * context so the device scales with its well like the other hardware props.
 */
export function IsolatedDevice(): ReactNode {
  return (
    <div className="isolatedDevice" aria-hidden="true">
      <div className="isolatedScene">
        <div className="isolatedShadow" />

        {/* Front-left case face — the larger vent bank, low on the wall. */}
        <div className="isolatedFace isolatedFace--left">
          <span className="isolatedVent isolatedVent--large" />
        </div>

        {/* Right case face — the smaller vent bank, up on the wall. */}
        <div className="isolatedFace isolatedFace--right">
          <span className="isolatedVent isolatedVent--small" />
        </div>

        {/* Brushed lid: recessed inner seam, four corner screws, etched mark. */}
        <div className="isolatedTop">
          <div className="isolatedSeam">
            <span className="isolatedScrew isolatedScrew--tl" />
            <span className="isolatedScrew isolatedScrew--tr" />
            <span className="isolatedScrew isolatedScrew--bl" />
            <span className="isolatedScrew isolatedScrew--br" />
          </div>
          <span className="isolatedMark" />
        </div>
      </div>
    </div>
  );
}
