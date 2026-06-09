import { type ReactNode } from "react";
import "./FeaturePanel.css";

export interface FeaturePanelFeature {
  readonly title: ReactNode;
  readonly description: ReactNode;
  /** Uppercase category, stamped as the overline on the metal section. */
  readonly tag: ReactNode;
}

interface FeaturePanelProps {
  readonly headline: ReactNode;
  readonly features: readonly FeaturePanelFeature[];
}

/**
 * Feature panel on the dark marketing surface. The headline is centered
 * across the top, with a row of floating cards below. Each card is a
 * two-part "metal ID card": a brushed-metal top plate stamped with the
 * category overline + title, fused to a translucent glass section that
 * carries the description, with a bright gold emissive seam + perimeter.
 */
export function FeaturePanel({
  headline,
  features,
}: FeaturePanelProps): ReactNode {
  return (
    <section className="featurePanel">
      <div className="featurePanelInner">
        <header className="featurePanelHeader">
          <h2 className="featurePanelHeadline">{headline}</h2>
        </header>
        <ul className="featurePanelGrid" role="list">
          {features.map((feature, index) => (
            <li key={index} className="featurePanelItem">
              <div className="featurePanelScene">
                <span className="featurePanelMetalOverline">{feature.tag}</span>
                <h3 className="featurePanelMetalTitle">{feature.title}</h3>
              </div>
              <div className="featurePanelItemBody">
                <span className="featurePanelGlassLine" aria-hidden="true" />
                <span className="featurePanelGlassSurface" aria-hidden="true" />
                <p className="featurePanelItemDesc">{feature.description}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Gold art-deco metal plate used as the shared top-of-card visual across
 * every FeaturePanel card. A raster image (not monoline SVG), so it sits
 * directly in the scene well rather than inheriting `currentColor`.
 */
export function MetalPlateScene(): ReactNode {
  return (
    <img
      src="/trust-metal-plate.png"
      alt=""
      className="featurePanelPlate"
      aria-hidden="true"
    />
  );
}

/**
 * "Private" scene: an emissive padlock over redacted data lines, selling
 * the "not directly identifiable" promise. Painted in `currentColor` so
 * the parent `.featurePanelSceneArt` glow tints the whole illustration.
 */
export function PrivacyScene(): ReactNode {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-hidden="true"
    >
      <rect x="32" y="54" width="56" height="46" rx="10" />
      <path d="M45 54V41a15 15 0 0 1 30 0v13" />
      <circle cx="60" cy="73" r="5.5" />
      <path d="M60 78.5v9" />
    </svg>
  );
}

/**
 * "Secure" scene: an emissive shield carrying a verification check over a
 * faint policy grid, selling the kernel/harness security posture.
 */
export function SecureScene(): ReactNode {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-hidden="true"
    >
      <path d="M60 22 90 33v23c0 20-12 34-30 41-18-7-30-21-30-41V33L60 22Z" />
      <path d="M48 61l9 9 16-19" strokeWidth="2.4" />
    </svg>
  );
}

/**
 * "Open Source" scene: emissive code brackets beside a fork/branch graph,
 * selling the MIT-licensed, fork-anytime promise.
 */
export function OpenSourceScene(): ReactNode {
  return (
    <svg
      viewBox="0 0 120 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-hidden="true"
    >
      <path d="M60 34v17" />
      <path d="M60 51c0 16-13 20-22 35" />
      <path d="M60 51c0 16 13 20 22 35" />
      <circle cx="60" cy="28" r="6" />
      <circle cx="36" cy="92" r="6" />
      <circle cx="84" cy="92" r="6" />
    </svg>
  );
}

export function LockIcon(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <rect x="4" y="10.5" width="16" height="10.5" />
      <path d="M7.5 10.5V7a4.5 4.5 0 0 1 9 0v3.5" />
    </svg>
  );
}

export function ShieldIcon(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path d="M12 3 4 6v6c0 4.5 3.2 8.4 8 9 4.8-.6 8-4.5 8-9V6l-8-3Z" />
    </svg>
  );
}

export function CodeIcon(): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path d="m9 8-5 4 5 4" />
      <path d="m15 8 5 4-5 4" />
    </svg>
  );
}
