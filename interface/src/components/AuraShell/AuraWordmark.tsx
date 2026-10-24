import { useTheme } from "@cypher-asi/zui";
import { useDesktopLogoColor } from "../../hooks/use-desktop-logo-color";
import styles from "./AuraShell.module.css";

/**
 * Desktop (authed) AURA wordmark.
 *
 * Renders the lettermark as a masked box tinted by the user's logo-color
 * preference, optionally animated by the pulse preference (fade or sweep).
 * The render model mirrors the live preview in Settings → Appearance
 * (`AppearanceSection`) one-for-one — same mask, same `aura-logo-*`
 * keyframes (injected by `logo-pulse-keyframes.ts`), same color
 * resolution — so the titlebar matches exactly what the settings panel
 * shows. An unset color falls through to the theme default (white in
 * dark, black in light).
 *
 * Scoped to the desktop titlebar; the public leading-slot wordmark stays
 * the plain PNG `<img>`.
 */
export function AuraWordmark(): React.ReactElement {
  const { resolvedTheme } = useTheme();
  const {
    color,
    pulseEnabled,
    pulseMode,
    pulseSpeed,
    pulseFromColor,
    sweepReversed,
    pauseDuration,
  } = useDesktopLogoColor();

  const defaultHex = resolvedTheme === "light" ? "#000000" : "#ffffff";
  const fromColor = pulseFromColor || defaultHex;
  const toColor = color || defaultHex;
  // Matches the preview: one cycle spans the pulse plus its pause.
  const duration = pulseSpeed + pauseDuration;

  if (!pulseEnabled) {
    return (
      <div
        className={styles.titleLogoDesktop}
        role="img"
        aria-label="AURA"
        style={{ backgroundColor: toColor }}
      />
    );
  }

  if (pulseMode === "fade") {
    return (
      <div
        className={styles.titleLogoDesktop}
        role="img"
        aria-label="AURA"
        style={
          {
            "--logo-pulse-from": fromColor,
            "--logo-pulse-to": toColor,
            animation: `aura-logo-fade ${duration}s ease-in-out infinite`,
          } as React.CSSProperties
        }
      />
    );
  }

  // Sweep: a single masked element backed by a `from | to | from`
  // gradient at 300% width — a "to"-colored band one element wide on a
  // "from" base. The `aura-logo-sweep` keyframes slide it one direction
  // so the band travels across (enters one edge, exits the other) and
  // loops seamlessly on the all-"from" ends, matching the original
  // clip-path sweep. Done on ONE element so the hairline mask is
  // rasterized once — the old two-layer version let the "from" color
  // bleed through along the strokes because the two masks could never
  // align pixel-for-pixel. The gradient is symmetric, so only the
  // keyframe direction differs for the reversed sweep.
  return (
    <div
      className={styles.titleLogoDesktop}
      role="img"
      aria-label="AURA"
      style={
        {
          backgroundImage: `linear-gradient(90deg, ${fromColor} 0 33.333%, ${toColor} 33.333% 66.667%, ${fromColor} 66.667% 100%)`,
          backgroundSize: "300% 100%",
          backgroundRepeat: "no-repeat",
          animation: `${
            sweepReversed ? "aura-logo-sweep-rev" : "aura-logo-sweep"
          } ${duration}s ease-in-out infinite`,
        } as React.CSSProperties
      }
    />
  );
}
