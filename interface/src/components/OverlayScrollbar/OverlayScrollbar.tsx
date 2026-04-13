import type { RefObject } from "react";
import { useOverlayScrollbar } from "../../hooks/use-overlay-scrollbar";
import styles from "./OverlayScrollbar.module.css";

interface OverlayScrollbarProps {
  scrollRef: RefObject<HTMLElement | null>;
  trackClassName?: string;
  thumbClassName?: string;
}

function joinClassNames(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function OverlayScrollbar({
  scrollRef,
  trackClassName,
  thumbClassName,
}: OverlayScrollbarProps) {
  const { thumbStyle, visible, onThumbPointerDown } = useOverlayScrollbar(scrollRef);

  return (
    <div className={joinClassNames(styles.scrollTrack, trackClassName)}>
      <div
        className={joinClassNames(
          styles.scrollThumb,
          visible && styles.scrollThumbVisible,
          thumbClassName,
        )}
        style={thumbStyle}
        onPointerDown={onThumbPointerDown}
      />
    </div>
  );
}
