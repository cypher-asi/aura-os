import {
  useCallback,
  useId,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

/** Engraved shape variants drawn in the metal plate of a FeaturePanel card. */
export type FeaturePanelShape = "circle" | "triangle" | "square";
import { Section } from "../Section";
import { TextCard } from "../TextCard";
import { TypewriterText } from "../../public-chat/TypewriterText";
import "./FeaturePanel.css";

export interface FeaturePanelFeature {
  readonly title: ReactNode;
  /**
   * Body copy in the glass section. A plain string so a click on the card
   * can replay it with the shared `TypewriterText` reveal.
   */
  readonly description: string;
  /** Uppercase category, stamped as the overline on the metal section. */
  readonly tag: ReactNode;
  /**
   * Optional engraved shape rendered in the metal plate. When set, the metal
   * section grows to show the shape reasonably large between the overline and
   * the title.
   */
  readonly shape?: FeaturePanelShape;
}

interface FeaturePanelProps {
  readonly headline: ReactNode;
  readonly features: readonly FeaturePanelFeature[];
}

/**
 * Feature panel on the dark marketing surface. Renders as a standard H2
 * intro section (the shared `<Section />` + `<TextCard level="h2" />`, so the
 * headline reserves the same centered whitespace as every other H2 intro on
 * the page) followed by a separate band of floating cards below. Each card is
 * a two-part "metal ID card": a brushed-metal top plate stamped with the
 * category overline + title, fused to a translucent glass section that carries
 * the description, with a bright gold emissive seam + perimeter.
 */
export function FeaturePanel({
  headline,
  features,
}: FeaturePanelProps): ReactNode {
  // Which card's description is currently playing the typewriter reveal, and
  // a nonce that bumps on every click so re-clicking the same card replays it
  // (the `TypewriterText` is keyed on the nonce, so it remounts and re-types).
  const [active, setActive] = useState<number | null>(null);
  const [playKey, setPlayKey] = useState<number>(0);
  const headlineId = useId();

  const play = useCallback((index: number): void => {
    setActive(index);
    setPlayKey((key) => key + 1);
  }, []);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLLIElement>, index: number): void => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        play(index);
      }
    },
    [play],
  );

  return (
    <>
      <Section
        ariaLabelledBy={headlineId}
        fullHeight={false}
        className="featurePanelIntro"
      >
        <TextCard level="h2" id={headlineId} headline={headline} />
      </Section>
      <section className="featurePanel" aria-labelledby={headlineId}>
        <ul className="featurePanelGrid" role="list">
          {features.map((feature, index) => (
            <li
              key={index}
              className={`featurePanelItem${
                feature.shape ? " featurePanelItem--media" : ""
              }`}
              role="button"
              tabIndex={0}
              onClick={() => play(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
            >
              <div
                className={`featurePanelScene${
                  feature.shape ? " featurePanelScene--media" : ""
                }`}
              >
                <span className="featurePanelMetalOverline">{feature.tag}</span>
                {feature.shape && (
                  <div className="featurePanelSceneFrame">
                    <EngravedShape kind={feature.shape} />
                  </div>
                )}
                <h3 className="featurePanelMetalTitle">{feature.title}</h3>
              </div>
              <div className="featurePanelItemBody">
                <span className="featurePanelGlassLine" aria-hidden="true" />
                <span className="featurePanelGlassSurface" aria-hidden="true" />
                <p className="featurePanelItemDesc">
                  {active === index ? (
                    <TypewriterText
                      key={playKey}
                      text={feature.description}
                      speedMs={16}
                    />
                  ) : (
                    feature.description
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

const ENGRAVED_GEOMETRY: Record<FeaturePanelShape, ReactNode> = {
  circle: <circle cx="60" cy="60" r="42" />,
  // Centered, slightly inset triangle so the thick stroke + inner shadow stay
  // inside the 120x120 viewBox.
  triangle: <polygon points="60,22 98,94 22,94" />,
  square: <rect x="20" y="20" width="80" height="80" rx="10" />,
};

/**
 * Engraved outline shape drawn in the metal plate of a FeaturePanel card.
 * Pure vector (no raster): a hollow shape (`fill="none"`) traced with a thick
 * darker border and an inner-shadow filter, so it reads as a recessed/engraved
 * border with the metal plate showing through the center. The band stroke is a
 * flat tone close to the background (no directional gradient), so it reads as a
 * recessed groove defined by its edge bevel + a uniform inner shadow that is
 * equal on every side. A slightly wider stroke sits behind the band so a 0.5px
 * gradient bevel (background color -> lighter, 50% opacity) shows on both the
 * inner and outer edges. Each instance mints unique `defs` IDs so cards never
 * collide.
 */
export function EngravedShape({
  kind,
}: {
  readonly kind: FeaturePanelShape;
}): ReactNode {
  const uid = useId().replace(/:/g, "");
  const shadowId = `engravedShadow-${uid}`;
  const edgeId = `engravedEdge-${uid}`;
  const geometry = ENGRAVED_GEOMETRY[kind];

  return (
    <svg
      className="featurePanelSceneShape"
      viewBox="0 0 120 120"
      role="img"
      aria-hidden="true"
    >
      <defs>
        {/* 0.5px edge bevel: a gradient that rises from the background color to
            a lighter tone, drawn on a wider stroke so it peeks out 0.5px on both
            the inner and outer contour of the band. */}
        <linearGradient id={edgeId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#161616" />
          <stop offset="100%" stopColor="#777777" />
        </linearGradient>
        {/* Inner shadow: punch the source out of a symmetric (un-offset) blur,
            then fill the resulting inner band with a soft black so the stroke
            looks engraved. With no offset and a flat stroke color, the shadow
            is uniform on every edge of the shape. */}
        <filter
          id={shadowId}
          x="-25%"
          y="-25%"
          width="150%"
          height="150%"
        >
          <feGaussianBlur in="SourceAlpha" stdDeviation="2.5" result="engravedBlur" />
          <feComposite
            in="SourceAlpha"
            in2="engravedBlur"
            operator="out"
            result="engravedInverse"
          />
          <feFlood floodColor="#000000" floodOpacity="0.9" />
          <feComposite
            in2="engravedInverse"
            operator="in"
            result="engravedShadow"
          />
          <feMerge>
            <feMergeNode in="SourceGraphic" />
            <feMergeNode in="engravedShadow" />
          </feMerge>
        </filter>
      </defs>
      <g fill="none" strokeLinejoin="round">
        {/* Wider stroke behind the band: the 0.5px sliver on each side becomes
            the inner + outer edge bevel, at 50% opacity. */}
        <g stroke={`url(#${edgeId})`} strokeWidth="12" opacity="0.5">
          {geometry}
        </g>
        {/* Main band: a flat dark tone close to the section background, so the
            border itself reads as recessed background and is defined only by the
            edge bevel + the uniform inner shadow. */}
        <g stroke="#161616" strokeWidth="11" filter={`url(#${shadowId})`}>
          {geometry}
        </g>
      </g>
    </svg>
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
