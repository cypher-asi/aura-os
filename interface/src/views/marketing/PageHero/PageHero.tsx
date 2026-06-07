import { type ReactNode, useState } from "react";
import "./PageHero.css";

interface PageHeroProps {
  readonly label?: string;
  readonly headline: ReactNode;
  readonly description: ReactNode;
  readonly ctaText?: string;
  readonly ctaIcon?: ReactNode;
  readonly ctaHref?: string;
  readonly onCtaClick?: () => void;
  readonly preview?: ReactNode | null;
  /**
   * When true, horizontally centers the label/headline/description/CTA
   * stack inside the hero column instead of the default left alignment.
   * Headline and description still respect their per-element
   * `max-width` caps; the wrapper just becomes `align-items: center` /
   * `text-align: center` so the inner blocks center as a group.
   */
  readonly centered?: boolean;
  /**
   * Optional looping `<video>` source rendered as a full-bleed,
   * `object-fit: cover` ambient background beneath the content layer.
   * The video is muted, autoplays, and is marked `aria-hidden` since
   * it's purely decorative. Pair with `backgroundImageSrc` to overlay
   * a centered figure / silhouette on top of the video.
   */
  readonly backgroundVideoSrc?: string;
  /**
   * Optional `<img>` source rendered as a full-bleed,
   * `object-fit: contain` layer above the background video and beneath
   * the content. Designed for a centered figure / silhouette on a
   * black field — its own black bg blends seamlessly into `.pageHero`'s
   * `#000` so the image reads as a free-floating figure rather than a
   * boxed inset, while the video continues to play in the contain-fit
   * letterbox bars on either side.
   */
  readonly backgroundImageSrc?: string;
  /**
   * Optional alt text for `backgroundImageSrc`. Defaults to `""`
   * (decorative) so the image is hidden from assistive tech and the
   * headline / description carry the page's accessible name.
   */
  readonly backgroundImageAlt?: string;
  /**
   * Optional CTA element rendered directly beneath the headline.
   * In `centered` mode the consuming view typically passes the
   * shared `<CreateAgentButton />` here so the neon-glow pill from
   * the public landing surface mounts under the headline pill,
   * keeping the call-to-action grouped with the title rather than
   * pinned to the bottom of the section like the description.
   * Slot accepts any `ReactNode`, so future centered heroes can
   * mount different CTA chrome without forking this component.
   */
  readonly headlineCta?: ReactNode;
  /**
   * Optional element rendered as an absolutely-positioned overlay
   * inside the flow video's box (`.pageHeroFlowVideo`). The
   * overlay's bounding box matches the video's bounding box, and
   * the wrapper is a flex column with `align-items: center` so an
   * overlay child centers vertically over the AURA orb's bright
   * spot at the video's midline. Pointer events on the wrapper
   * itself are disabled so a transparent overlay never blocks
   * clicks on the video; pointer events are re-enabled on the
   * direct children, so an interactive overlay (the
   * `<AgentMarquee />` strip on the product page) still receives
   * cursor + keyboard input. Only meaningful when `centered` is
   * true and `backgroundVideoSrc` is set, since those are the two
   * conditions that make the flow video render in the first place.
   */
  readonly videoOverlay?: ReactNode;
}

/**
 * Marketing page hero. Ported from
 * `aura-web/src/components/PageHero/PageHero.tsx`. The aura-web source
 * delegated the CTA to a shared `ButtonAction` component; we inline a
 * minimal anchor-button replacement here so this component stays
 * self-contained inside the marketing port.
 *
 * Consumers can render the CTA in two modes:
 *   - `ctaHref` set     -> renders as an `<a>` (external links, hashes).
 *   - `onCtaClick` only -> renders as a `<button>`.
 *
 * Today only the Product view uses this component, and it passes
 * `preview={null}` with no `ctaText`, so neither branch is currently hit
 * in production. The styles are kept ready for future marketing pages.
 */
export function PageHero({
  label,
  headline,
  description,
  ctaText,
  ctaIcon,
  ctaHref,
  onCtaClick,
  preview,
  centered = false,
  backgroundVideoSrc,
  backgroundImageSrc,
  backgroundImageAlt = "",
  headlineCta,
  videoOverlay,
}: PageHeroProps): ReactNode {
  const [flowVideoReady, setFlowVideoReady] = useState(false);

  const pageHeroClassName = [
    "pageHero",
    preview === null ? "pageHeroNoPreview" : null,
    centered ? "pageHeroCentered" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const contentClassName = centered
    ? "pageHeroContent pageHeroContentCentered"
    : "pageHeroContent";

  /*
   * In `centered` mode the background video is no longer painted as
   * an absolutely-positioned full-bleed backdrop behind the headline.
   * Instead it flows as a regular block immediately AFTER the
   * centered content column, so the first viewport is owned by the
   * headline / description / CTA stack and the video sits below the
   * fold with only its top edge peeking at the bottom of the screen.
   * The user scrolls to reveal the rest of the loop. Non-centered
   * heroes keep the original behind-content backdrop treatment for
   * backward compatibility with future marketing pages.
   */
  const renderBackdropMedia = !centered;
  const renderFlowVideo = centered && Boolean(backgroundVideoSrc);

  return (
    <section className={pageHeroClassName}>
      {renderBackdropMedia && backgroundVideoSrc ? (
        <video
          className="pageHeroBackgroundVideo"
          src={backgroundVideoSrc}
          autoPlay
          loop
          muted
          playsInline
          aria-hidden="true"
        />
      ) : null}
      {renderBackdropMedia && backgroundImageSrc ? (
        <img
          className="pageHeroBackgroundImage"
          src={backgroundImageSrc}
          alt={backgroundImageAlt}
          aria-hidden={backgroundImageAlt === "" ? true : undefined}
          draggable={false}
        />
      ) : null}
      {renderBackdropMedia &&
      (backgroundVideoSrc || backgroundImageSrc) ? (
        <div className="pageHeroVignette" aria-hidden="true" />
      ) : null}
      <div className={contentClassName}>
        {centered ? (
          /*
           * Centered mode wraps the headline / description / CTA
           * trio in a `pageHeroCenteredStack` div so the parent
           * `.pageHeroContentCentered` column has a SINGLE flex
           * child to center. With the content area sized at the
           * full viewport height (see PageHero.css) and
           * `justify-content: center` on the parent, the wrapper
           * lands at the true 50vh midpoint — so the top distance
           * from the viewport top to the headline equals the
           * bottom distance from the CTA to the viewport bottom
           * on initial load, regardless of where the flowing
           * video sits below.
           */
          <div className="pageHeroCenteredStack">
            {label ? (
              <span className="pageHeroLabel">{label}</span>
            ) : null}
            <h1 className="pageHeroHeadline">{headline}</h1>
            <p className="pageHeroDescription pageHeroDescriptionInline">
              {description}
            </p>
            {headlineCta ? (
              <div className="pageHeroHeadlineCta">{headlineCta}</div>
            ) : null}
          </div>
        ) : (
          <>
            {label ? (
              <span className="pageHeroLabel">{label}</span>
            ) : null}
            <h1 className="pageHeroHeadline">{headline}</h1>
            {headlineCta ? (
              <div className="pageHeroHeadlineCta">{headlineCta}</div>
            ) : null}
            <p className="pageHeroDescription">{description}</p>
            {ctaText ? (
              <div className="pageHeroActions">
                {ctaHref ? (
                  <a
                    href={ctaHref}
                    className="pageHeroCtaButton"
                    onClick={onCtaClick}
                  >
                    {ctaIcon ? (
                      <span aria-hidden="true">{ctaIcon}</span>
                    ) : null}
                    {ctaText}
                  </a>
                ) : (
                  <button
                    type="button"
                    className="pageHeroCtaButton"
                    onClick={onCtaClick}
                  >
                    {ctaIcon ? (
                      <span aria-hidden="true">{ctaIcon}</span>
                    ) : null}
                    {ctaText}
                  </button>
                )}
              </div>
            ) : null}
          </>
        )}
      </div>
      {renderFlowVideo ? (
        /*
         * Flow video + optional overlay live inside a single
         * positioning wrapper so an absolutely-positioned
         * `videoOverlay` sibling tracks the video's box exactly
         * (instead of the entire `.pageHero` section, which would
         * include the centered headline column above it). The
         * wrapper carries the video's old `position: relative;
         * z-index: 1` so existing layering — content stack on top,
         * video below the fold — is preserved.
         *
         * `width` / `height` attributes on the `<video>` mirror
         * the source's intrinsic 1280×720 dimensions so the
         * browser computes the aspect-ratio box from the FIRST
         * render — before the mp4 metadata is fetched, before
         * `loadedmetadata` fires, and before the
         * `.pageHeroFlowVideo` stylesheet rule's
         * `aspect-ratio: 1280 / 720` is necessarily applied.
         * They are intentionally NOT used as sizing constraints;
         * the `.pageHeroFlowVideo` rule still drives the rendered
         * width (`width: 100%`) and height (derived from
         * `aspect-ratio`). The attributes only exist to lock the
         * intrinsic ratio for the very first paint frame, which
         * is what eliminates the headline jank where
         * `ProductScreenSection` directly below would snap down
         * the moment the browser learned the video's true height.
         */
        <div className="pageHeroFlowVideoWrapper">
          <video
            className={`pageHeroFlowVideo${
              flowVideoReady ? " pageHeroFlowVideoReady" : ""
            }`}
            src={backgroundVideoSrc}
            width={1280}
            height={720}
            autoPlay
            loop
            muted
            playsInline
            aria-hidden="true"
            onCanPlay={() => setFlowVideoReady(true)}
          />
          {videoOverlay ? (
            <div className="pageHeroVideoOverlay">{videoOverlay}</div>
          ) : null}
        </div>
      ) : null}
      {preview !== null ? (
        <div className="pageHeroPreview">
          {preview ?? <div className="pageHeroPreviewPlaceholder" />}
        </div>
      ) : null}
    </section>
  );
}
