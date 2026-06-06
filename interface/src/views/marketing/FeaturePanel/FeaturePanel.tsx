import { type ReactNode } from "react";
import "./FeaturePanel.css";

export interface FeaturePanelFeature {
  /**
   * Rich illustration scene rendered inside the dark `DeviceScreen`
   * glass tile at the top of each card (see the `*Scene` exports below).
   */
  readonly illustration: ReactNode;
  readonly title: ReactNode;
  readonly description: ReactNode;
  /** Static uppercase label shown in the bottom-left pill. */
  readonly tag: ReactNode;
  /** Highlights this card with the brand orange surface. */
  readonly accent?: boolean;
}

interface FeaturePanelProps {
  readonly headline: ReactNode;
  readonly features: readonly FeaturePanelFeature[];
}

/**
 * Feature panel on the dark marketing surface. The headline is centered
 * across the top, with a row of floating black cards below — each card
 * holds a glowing illustration scene above its title + description,
 * echoing the reference three-up scene layout.
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
            <li
              key={index}
              className={
                feature.accent
                  ? "featurePanelItem featurePanelItemAccent"
                  : "featurePanelItem"
              }
            >
              <div className="featurePanelScene" aria-hidden="true">
                <div className="featurePanelSceneArt">{feature.illustration}</div>
              </div>
              <div className="featurePanelItemBody">
                <h3 className="featurePanelItemTitle">{feature.title}</h3>
                <p className="featurePanelItemDesc">{feature.description}</p>
                <span className="featurePanelItemTag">{feature.tag}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
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
      viewBox="0 0 200 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-hidden="true"
    >
      <g opacity="0.45">
        <line x1="26" y1="34" x2="78" y2="34" />
        <line x1="26" y1="50" x2="64" y2="50" />
        <line x1="26" y1="66" x2="82" y2="66" />
        <line x1="26" y1="82" x2="58" y2="82" />
      </g>
      <g opacity="0.45">
        <line x1="120" y1="34" x2="174" y2="34" strokeDasharray="4 5" />
        <line x1="134" y1="50" x2="174" y2="50" strokeDasharray="4 5" />
        <line x1="120" y1="82" x2="174" y2="82" strokeDasharray="4 5" />
      </g>
      <g transform="translate(82 36)">
        <rect x="0" y="20" width="36" height="28" rx="5" fill="currentColor" fillOpacity="0.14" />
        <rect x="0" y="20" width="36" height="28" rx="5" />
        <path d="M7 20v-7a11 11 0 0 1 22 0v7" />
        <circle cx="18" cy="32" r="3" fill="currentColor" />
        <line x1="18" y1="35" x2="18" y2="41" />
      </g>
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
      viewBox="0 0 200 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-hidden="true"
    >
      <g opacity="0.32">
        <line x1="20" y1="24" x2="180" y2="24" />
        <line x1="20" y1="60" x2="180" y2="60" />
        <line x1="20" y1="96" x2="180" y2="96" />
        <line x1="56" y1="14" x2="56" y2="106" />
        <line x1="144" y1="14" x2="144" y2="106" />
      </g>
      <g transform="translate(76 22)">
        <path
          d="M24 2 4 9v22c0 16 11.5 30 20 33 8.5-3 20-17 20-33V9L24 2Z"
          fill="currentColor"
          fillOpacity="0.14"
        />
        <path d="M24 2 4 9v22c0 16 11.5 30 20 33 8.5-3 20-17 20-33V9L24 2Z" />
        <path d="M15 33l7 7 12-15" strokeWidth="2" />
      </g>
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
      viewBox="0 0 200 120"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
      aria-hidden="true"
    >
      <g strokeWidth="2.5" opacity="0.9">
        <path d="M58 36 36 60l22 24" />
        <path d="M104 36l22 24-22 24" />
      </g>
      <line x1="78" y1="34" x2="90" y2="86" opacity="0.5" />
      <g transform="translate(140 22)">
        <circle cx="0" cy="6" r="5" fill="currentColor" fillOpacity="0.18" />
        <circle cx="0" cy="6" r="5" />
        <circle cx="0" cy="70" r="5" fill="currentColor" fillOpacity="0.18" />
        <circle cx="0" cy="70" r="5" />
        <circle cx="34" cy="38" r="5" fill="currentColor" fillOpacity="0.18" />
        <circle cx="34" cy="38" r="5" />
        <path d="M0 11v54" />
        <path d="M0 38h29" />
      </g>
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
