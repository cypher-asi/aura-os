import { useState } from "react";
import { DynamicIcon } from "lucide-react/dynamic";
import { useProjectAppearance } from "../../hooks/use-project-appearance";
import styles from "./ProjectBanner.module.css";

interface ProjectBannerProps {
  projectId: string;
  /** Optional project name to overlay on the banner. Skipped when not
   *  set so the banner can render in headerless contexts. */
  projectName?: string;
}

/**
 * Header strip showing the project's banner image, icon, and name.
 * Returns `null` when the project has no banner *and* no icon — there
 * is nothing to differentiate visually, so painting an empty box just
 * pushes content down. Accent color is used as a subtle border tint
 * when set, so projects with only an accent (no banner / icon) still
 * read as themed if the parent wraps this component anyway.
 *
 * The banner image is loaded via `<img>` and falls back to a
 * non-rendering state on 404 via `onError`. This dodges needing a
 * preflight HEAD request and matches how the appearance tab's own
 * preview works.
 */
export function ProjectBanner({ projectId, projectName }: ProjectBannerProps) {
  const { appearance, bannerUrl } = useProjectAppearance(projectId);
  const [bannerLoaded, setBannerLoaded] = useState(true);

  const hasBanner = bannerLoaded;
  const hasIcon = !!appearance.icon;
  const hasAccent = !!appearance.accent;
  const hasContent = hasBanner || hasIcon || hasAccent || !!projectName;

  if (!hasContent) return null;

  return (
    <div
      className={styles.banner}
      style={appearance.accent ? { borderColor: appearance.accent } : undefined}
    >
      <img
        src={bannerUrl}
        alt=""
        className={styles.image}
        onError={() => setBannerLoaded(false)}
        onLoad={() => setBannerLoaded(true)}
        aria-hidden={!hasBanner}
        // Hidden state collapses the image entirely; visible state
        // switches `object-fit` to `contain` when the user uploaded
        // in scale-to-fit mode so the full image shows letterboxed
        // rather than cover-cropped to 16:5.
        style={
          !hasBanner
            ? { display: "none" }
            : appearance.bannerScaleToFit
              ? { objectFit: "contain" }
              : undefined
        }
      />
      <div className={styles.overlay}>
        {hasIcon && (
          <span
            className={styles.iconChip}
            style={appearance.accent ? { background: appearance.accent } : undefined}
          >
            <DynamicIcon
              name={appearance.icon as Parameters<typeof DynamicIcon>[0]["name"]}
              size={20}
              color="#fff"
            />
          </span>
        )}
        {projectName && <span className={styles.name}>{projectName}</span>}
      </div>
    </div>
  );
}
