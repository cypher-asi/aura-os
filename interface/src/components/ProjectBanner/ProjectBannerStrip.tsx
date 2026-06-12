import { useEffect, useState } from "react";
import { useProjectAppearance } from "../../hooks/use-project-appearance";
import styles from "./ProjectBannerStrip.module.css";

interface ProjectBannerStripProps {
  projectId: string;
}

/**
 * Slim banner strip rendered at the top of `ProjectLayout` whenever
 * a project has a banner image uploaded. Distinct from `ProjectBanner`
 * (the larger overlay-style header used on `ProjectEmptyView`) — this
 * one is image-only, fixed-height, and returns nothing when the
 * project has no banner so unthemed projects don't grow a strip on
 * every page.
 *
 * Returns `null` until the image actually loads, so a project with
 * no `.aura/banner.{png,jpg}` doesn't render an empty box while the
 * `<img>`'s GET is in flight or after it 404s.
 */
export function ProjectBannerStrip({ projectId }: ProjectBannerStripProps) {
  const { appearance, bannerUrl } = useProjectAppearance(projectId);
  const [loaded, setLoaded] = useState(false);

  // Reset the "did this URL succeed?" flag whenever the URL changes
  // (cache-bust on upload/delete bumps `?v=`). Mirrors the same
  // useEffect pattern in `BannerControl`.
  useEffect(() => {
    setLoaded(false);
  }, [bannerUrl]);

  if (!bannerUrl) return null;

  // When the user opted into scale-to-fit during upload, switch the
  // `<img>`'s object-fit so the full image shows letterboxed instead
  // of being cover-cropped to the strip's aspect ratio.
  const scaleToFit = appearance.bannerScaleToFit === true;

  return (
    <div
      className={styles.strip}
      style={loaded ? undefined : { display: "none" }}
    >
      <img
        src={bannerUrl}
        alt=""
        className={styles.image}
        style={scaleToFit ? { objectFit: "contain" } : undefined}
        onLoad={() => setLoaded(true)}
        onError={() => setLoaded(false)}
      />
    </div>
  );
}
