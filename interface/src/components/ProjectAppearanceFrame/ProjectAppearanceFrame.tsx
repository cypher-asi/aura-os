import { type CSSProperties, type ReactNode } from "react";
import { useProjectAppearance } from "../../hooks/use-project-appearance";
import styles from "./ProjectAppearanceFrame.module.css";

interface ProjectAppearanceFrameProps {
  projectId: string | null | undefined;
  children: ReactNode;
}

/**
 * Wraps the project's content area and emits CSS custom properties
 * derived from the project's `appearance.json`. Descendant components
 * opt into per-project styling by reading the variables — there is no
 * inline coupling between this frame and individual surfaces.
 *
 * Variables emitted:
 *
 * - `--project-accent` — accent color hex, or `unset` so children can
 *   fall back to a theme default.
 * - `--project-bg-color` — background tint color.
 * - `--project-bg-opacity` — opacity (0..1) applied to the pattern
 *   overlay, *not* the color.
 *
 * The background pattern is switched via the `data-bg-pattern`
 * attribute (read by `ProjectAppearanceFrame.module.css`) rather than
 * a CSS variable, because `background-image` can't be parametrized
 * cleanly with custom properties when the value is a `url()` /
 * gradient that differs in shape between patterns.
 */
export function ProjectAppearanceFrame({
  projectId,
  children,
}: ProjectAppearanceFrameProps) {
  const { appearance, backgroundImageUrl } = useProjectAppearance(projectId);

  const style: CSSProperties = {};
  if (appearance.accent) {
    (style as Record<string, string>)["--project-accent"] = appearance.accent;
  }
  if (appearance.background?.color) {
    (style as Record<string, string>)["--project-bg-color"] =
      appearance.background.color;
  }
  if (typeof appearance.background?.opacity === "number") {
    (style as Record<string, string>)["--project-bg-opacity"] =
      String(appearance.background.opacity);
  }
  if (typeof appearance.background?.patternSize === "number") {
    (style as Record<string, string>)["--project-bg-pattern-scale"] =
      String(appearance.background.patternSize);
  }

  const rawPattern = appearance.background?.pattern ?? "none";
  // Legacy `none` is treated as `solid` for new code paths: when the
  // user has a color set with no overlay, the unified "solid" branch
  // paints the color at the chosen opacity. Both values still produce
  // the same visual when no color is set (i.e. nothing renders).
  const pattern = rawPattern === "none" ? "solid" : rawPattern;

  // Pipe the cache-busted background image URL into the CSS as a
  // custom property so the `data-bg-pattern="image"` rule can pick it
  // up via `url(var(--project-bg-image))`. Wrapped in `url("...")`
  // here so the CSS doesn't have to know about quoting.
  if (pattern === "image" && backgroundImageUrl) {
    (style as Record<string, string>)["--project-bg-image"] =
      `url("${backgroundImageUrl}")`;
  }

  const invert = appearance.background?.invert === true;
  const frost = appearance.background?.frost === true;
  // 1-30 px range (slider) with 8 as the default-when-enabled. Falls
  // back here rather than at the CSS level so the inline style is
  // always a complete `blur(Npx)` value.
  const frostAmount =
    frost && typeof appearance.background?.frostAmount === "number"
      ? Math.max(0, Math.min(30, appearance.background.frostAmount))
      : 8;

  return (
    <div
      className={styles.frame}
      style={style}
      data-project-appearance-frame=""
      data-bg-pattern={pattern}
      data-bg-invert={invert ? "true" : undefined}
      data-project-id={projectId ?? undefined}
    >
      {/* Frosted-glass layer between the background painting (color,
          pattern, image) and the content. Sits at z-index 0 so it
          paints over the negative-z pseudo-elements; the content
          wrapper below sits at z-index 1 to ensure children render
          on top of the frost regardless of normal-flow / positioned
          painting rules. */}
      {frost && (
        <div
          className={styles.frost}
          style={{ backdropFilter: `blur(${frostAmount}px)` }}
          aria-hidden="true"
        />
      )}
      <div className={styles.content}>{children}</div>
    </div>
  );
}
