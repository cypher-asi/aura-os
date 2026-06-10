import {
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import "./ProductScreenSection.css";

type LightboxPhase = "closed" | "opening" | "open" | "closing";

interface ImageRect {
  readonly top: number;
  readonly left: number;
  readonly width: number;
  readonly height: number;
}

interface ProductScreenSectionProps {
  readonly headline: ReactNode;
  readonly description?: ReactNode;
  readonly centered?: boolean;
  readonly showMedia?: boolean;
  readonly placeholderLabel?: string;
  readonly imageSrc?: string;
  readonly imageAlt?: string;
}

const IMAGE_ANIMATION_MS = 420;
const BACKDROP_ANIMATION_MS = 220;
const DESKTOP_LIGHTBOX_PADDING = 24;
const MOBILE_LIGHTBOX_PADDING = 16;

function getViewportPadding(): number {
  return window.innerWidth <= 768
    ? MOBILE_LIGHTBOX_PADDING
    : DESKTOP_LIGHTBOX_PADDING;
}

function getImageAspectRatio(imageElement: HTMLImageElement | null): number {
  if (!imageElement) {
    return 16 / 9;
  }

  if (imageElement.naturalWidth > 0 && imageElement.naturalHeight > 0) {
    return imageElement.naturalWidth / imageElement.naturalHeight;
  }

  if (imageElement.clientWidth > 0 && imageElement.clientHeight > 0) {
    return imageElement.clientWidth / imageElement.clientHeight;
  }

  return 16 / 9;
}

function getFullscreenRect(imageElement: HTMLImageElement | null): ImageRect {
  const viewportPadding = getViewportPadding();
  const maxWidth = Math.max(window.innerWidth - viewportPadding * 2, 0);
  const maxHeight = Math.max(window.innerHeight - viewportPadding * 2, 0);
  const aspectRatio = getImageAspectRatio(imageElement);

  let width = maxWidth;
  let height = width / aspectRatio;

  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspectRatio;
  }

  return {
    top: (window.innerHeight - height) / 2,
    left: (window.innerWidth - width) / 2,
    width,
    height,
  };
}

function getRectStyle(rect: ImageRect | null): CSSProperties | undefined {
  if (!rect) {
    return undefined;
  }

  return {
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  };
}

/**
 * Ported from `aura-web/src/components/ProductScreenSection/ProductScreenSection.tsx`.
 * Renders a headlined image section that expands into a fullscreen lightbox
 * with a Web Animations API zoom on click. The lightbox honors
 * `prefers-reduced-motion` and is rendered through a `react-dom` portal to
 * `document.body` so it escapes the marketing layout stacking context.
 *
 * Notable deviations from the source:
 *   - The `'use client'` directive is dropped (Vite SPA has no RSC bound).
 *   - The unused `buildTransform` helper from the source is removed to
 *     keep the file lint-clean under `--max-warnings 0`.
 */
export function ProductScreenSection({
  headline,
  description,
  centered = false,
  showMedia = true,
  placeholderLabel = "Image placeholder",
  imageSrc,
  imageAlt,
}: ProductScreenSectionProps): ReactNode {
  const { t } = useTranslation("marketing");
  const resolvedPlaceholderLabel =
    placeholderLabel === "Image placeholder"
      ? t("productScreen.placeholderLabel", {
          defaultValue: "Image placeholder",
        })
      : placeholderLabel;
  const inlineImageRef = useRef<HTMLImageElement | null>(null);
  const animatedImageShellRef = useRef<HTMLDivElement | null>(null);
  const backdropRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const activeAnimationsRef = useRef<Animation[]>([]);
  const [phase, setPhase] = useState<LightboxPhase>("closed");
  const [originRect, setOriginRect] = useState<ImageRect | null>(null);
  const [targetRect, setTargetRect] = useState<ImageRect | null>(null);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  const isLightboxVisible = phase !== "closed";

  const cancelAnimations = useCallback((): void => {
    activeAnimationsRef.current.forEach((animation) => {
      animation.cancel();
    });
    activeAnimationsRef.current = [];
  }, []);

  const closeFullscreen = useCallback((): void => {
    setPhase((current) => {
      if (current === "closed" || current === "closing") {
        return current;
      }

      if (prefersReducedMotion) {
        return "closed";
      }

      const inline = inlineImageRef.current;
      if (inline) {
        setOriginRect(inline.getBoundingClientRect());
      }

      return "closing";
    });
  }, [prefersReducedMotion]);

  const runOpenAnimation = useCallback((): void => {
    if (
      !animatedImageShellRef.current ||
      !backdropRef.current ||
      !originRect ||
      !targetRect
    ) {
      setPhase("open");
      return;
    }

    cancelAnimations();

    const imageAnimation = animatedImageShellRef.current.animate(
      [
        {
          transform: "scale(0.92)",
          opacity: 0,
        },
        {
          transform: "scale(1)",
          opacity: 1,
        },
      ],
      {
        duration: IMAGE_ANIMATION_MS,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
        fill: "forwards",
      },
    );

    const backdropAnimation = backdropRef.current.animate(
      [{ opacity: 0 }, { opacity: 1 }],
      {
        duration: BACKDROP_ANIMATION_MS,
        easing: "ease-out",
        fill: "forwards",
      },
    );

    const closeAnimation = closeButtonRef.current?.animate(
      [
        { opacity: 0, transform: "translateY(-8px)" },
        { opacity: 1, transform: "translateY(0px)" },
      ],
      {
        duration: 180,
        easing: "ease-out",
        fill: "forwards",
        delay: 100,
      },
    );

    activeAnimationsRef.current = [
      imageAnimation,
      backdropAnimation,
      closeAnimation,
    ].filter((animation): animation is Animation => Boolean(animation));

    imageAnimation.addEventListener(
      "finish",
      () => {
        activeAnimationsRef.current = [];
        setPhase("open");
      },
      { once: true },
    );
  }, [cancelAnimations, originRect, targetRect]);

  const runCloseAnimation = useCallback((): void => {
    if (
      !animatedImageShellRef.current ||
      !backdropRef.current ||
      !originRect ||
      !targetRect
    ) {
      setPhase("closed");
      return;
    }

    cancelAnimations();

    const imageAnimation = animatedImageShellRef.current.animate(
      [
        {
          transform: "scale(1)",
          opacity: 1,
        },
        {
          transform: "scale(0.92)",
          opacity: 0,
        },
      ],
      {
        duration: 340,
        easing: "cubic-bezier(0.7, 0, 0.84, 0)",
        fill: "forwards",
      },
    );

    const backdropAnimation = backdropRef.current.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      {
        duration: 180,
        easing: "ease-out",
        fill: "forwards",
      },
    );

    const closeAnimation = closeButtonRef.current?.animate(
      [
        { opacity: 1, transform: "translateY(0px)" },
        { opacity: 0, transform: "translateY(-8px)" },
      ],
      {
        duration: 120,
        easing: "ease-in",
        fill: "forwards",
      },
    );

    activeAnimationsRef.current = [
      imageAnimation,
      backdropAnimation,
      closeAnimation,
    ].filter((animation): animation is Animation => Boolean(animation));

    imageAnimation.addEventListener(
      "finish",
      () => {
        activeAnimationsRef.current = [];
        setPhase("closed");
      },
      { once: true },
    );
  }, [cancelAnimations, originRect, targetRect]);

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

    const syncReducedMotionPreference = (): void => {
      setPrefersReducedMotion(mediaQuery.matches);
    };

    syncReducedMotionPreference();
    mediaQuery.addEventListener("change", syncReducedMotionPreference);

    return () => {
      mediaQuery.removeEventListener("change", syncReducedMotionPreference);
    };
  }, []);

  useEffect(() => {
    if (!isLightboxVisible) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        closeFullscreen();
      }
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [closeFullscreen, isLightboxVisible]);

  useEffect(() => {
    if (phase !== "open") {
      return undefined;
    }

    const handleResize = (): void => {
      setTargetRect(getFullscreenRect(inlineImageRef.current));
    };

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, [phase]);

  useLayoutEffect(() => {
    if (prefersReducedMotion) {
      // Reduced-motion users skip the Web Animations zoom entirely. The
      // call sites (`openFullscreen` / `closeFullscreen`) already collapse
      // straight to the terminal phase when the preference is set at
      // click-time, but this branch catches the rare case where the OS
      // setting flips between phase transitions.
      if (phase === "opening") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPhase("open");
      }

      if (phase === "closing") {
        setPhase("closed");
      }

      return;
    }

    if (phase === "opening") {
      runOpenAnimation();
    }

    if (phase === "closing") {
      runCloseAnimation();
    }
  }, [phase, prefersReducedMotion, runOpenAnimation, runCloseAnimation]);

  useEffect(() => {
    if (phase !== "closed") {
      return undefined;
    }

    // After the lightbox finishes closing we drop the captured rects so a
    // subsequent open() call starts from the fresh inline image position
    // instead of stale coordinates. The eslint rule flags the setState as
    // cascading, but it only fires when the phase has settled to "closed"
    // so there's no animation conflict — see the
    // `cancelAnimations.current = []` reset in `runCloseAnimation` for the
    // companion teardown.
    cancelAnimations();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOriginRect(null);
    setTargetRect(null);

    return undefined;
  }, [cancelAnimations, phase]);

  useEffect(() => {
    return () => {
      cancelAnimations();
    };
  }, [cancelAnimations]);

  const openFullscreen = (): void => {
    if (!inlineImageRef.current) {
      return;
    }

    setOriginRect(inlineImageRef.current.getBoundingClientRect());
    setTargetRect(getFullscreenRect(inlineImageRef.current));

    if (prefersReducedMotion) {
      setPhase("open");
      return;
    }

    setPhase("opening");
  };

  const stopLightboxClose = (event: MouseEvent<HTMLDivElement>): void => {
    event.stopPropagation();
  };

  const lightbox =
    isLightboxVisible && targetRect && typeof document !== "undefined"
      ? createPortal(
          <div
            className="productScreenSectionLightbox"
            role="dialog"
            aria-modal="true"
            aria-label={imageAlt ?? resolvedPlaceholderLabel}
            onClick={closeFullscreen}
          >
            <div
              ref={backdropRef}
              className="productScreenSectionLightboxBackdrop"
            />
            <button
              ref={closeButtonRef}
              type="button"
              className="productScreenSectionLightboxClose"
              onClick={closeFullscreen}
              aria-label={t("productScreen.closeFullscreenAriaLabel", {
                defaultValue: "Close fullscreen image",
              })}
            >
              {t("productScreen.close", { defaultValue: "Close" })}
            </button>
            <div
              ref={animatedImageShellRef}
              className="productScreenSectionLightboxImageShell"
              style={getRectStyle(targetRect)}
              onClick={stopLightboxClose}
            >
              <img
                src={imageSrc}
                alt={imageAlt ?? resolvedPlaceholderLabel}
                className="productScreenSectionLightboxImage"
              />
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <section
      className={`productScreenSection ${
        centered ? "productScreenSectionCentered" : ""
      }`}
    >
      <div className="productScreenSectionInner">
        <h2 className="productScreenSectionHeadline">{headline}</h2>
        {description ? (
          <p className="productScreenSectionDescription">{description}</p>
        ) : null}
        {showMedia ? (
          imageSrc ? (
            <>
              <button
                type="button"
                className="productScreenSectionImageButton"
                onClick={openFullscreen}
                aria-label={t("productScreen.openFullscreenAriaLabel", {
                  defaultValue: `Open fullscreen image: ${
                    imageAlt ?? resolvedPlaceholderLabel
                  }`,
                  label: imageAlt ?? resolvedPlaceholderLabel,
                })}
              >
                <div
                  className={`productScreenSectionImageFrame ${
                    isLightboxVisible
                      ? "productScreenSectionImageFrameHidden"
                      : ""
                  }`}
                >
                  <img
                    ref={inlineImageRef}
                    src={imageSrc}
                    alt={imageAlt ?? resolvedPlaceholderLabel}
                    className="productScreenSectionImage"
                  />
                </div>
              </button>
              {lightbox}
            </>
          ) : (
            <div
              className="productScreenSectionPlaceholder"
              aria-label={resolvedPlaceholderLabel}
              role="img"
            >
              <span>{resolvedPlaceholderLabel}</span>
            </div>
          )
        ) : null}
      </div>
    </section>
  );
}
