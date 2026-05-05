import type { CSSProperties } from "react";
import { useTheme } from "@cypher-asi/zui";
import { useDesktopBackgroundStore } from "../../stores/desktop-background-store";
import styles from "./DesktopShell.module.css";

export function BackgroundLayer() {
  const light = useDesktopBackgroundStore((s) => s.light);
  const dark = useDesktopBackgroundStore((s) => s.dark);
  const hydrated = useDesktopBackgroundStore((s) => s.hydrated);
  const { resolvedTheme } = useTheme();

  const active = resolvedTheme === "light" ? light : dark;

  if (!hydrated || active.mode === "none") return null;
  if (active.mode === "image" && !active.imageDataUrl) return null;

  const style: CSSProperties =
    active.mode === "color"
      ? { backgroundColor: active.color }
      : {
          backgroundImage: `url(${active.imageDataUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        };

  return <div className={styles.backgroundLayer} style={style} />;
}
