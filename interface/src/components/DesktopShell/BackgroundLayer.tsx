import type { CSSProperties } from "react";
import { useDesktopBackgroundStore } from "../../stores/desktop-background-store";
import styles from "./DesktopShell.module.css";

export function BackgroundLayer() {
  const mode = useDesktopBackgroundStore((s) => s.mode);
  const color = useDesktopBackgroundStore((s) => s.color);
  const imageDataUrl = useDesktopBackgroundStore((s) => s.imageDataUrl);
  const hydrated = useDesktopBackgroundStore((s) => s.hydrated);

  if (!hydrated || mode === "none") return null;
  if (mode === "image" && !imageDataUrl) return null;

  const style: CSSProperties =
    mode === "color"
      ? { backgroundColor: color }
      : {
          backgroundImage: `url(${imageDataUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        };

  return <div className={styles.backgroundLayer} style={style} />;
}
