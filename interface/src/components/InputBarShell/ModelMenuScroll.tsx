import {
  memo,
  useCallback,
  useRef,
  useState,
  type HTMLAttributes,
  type ReactNode,
} from "react";
import { OverlayScrollbar } from "../OverlayScrollbar";
import styles from "./InputBarShell.module.css";

export interface ModelMenuScrollProps
  extends HTMLAttributes<HTMLDivElement> {
  /** Menu rows / groups rendered inside the scroll area. */
  children: ReactNode;
  /**
   * Pin the menu width to its natural (fully-expanded) width on mount so
   * later collapsing a vendor section can't shrink it. The menu always
   * opens fully expanded, so the locked value matches the first paint —
   * no visible jump.
   */
  lockWidth?: boolean;
}

/**
 * Chrome + custom scrollbar wrapper for the chat model picker menu.
 *
 * The outer `.modelMenu` keeps the visual chrome (border, bg, radius,
 * min-width) but the `.modelMenuOverlayHost` modifier moves overflow onto
 * an inner scroller so the shared {@link OverlayScrollbar} can mount as a
 * sibling (the hook positions its track against the relatively-positioned
 * outer element and reads the scroller's parent for hover). The native
 * scrollbar is hidden via `.modelMenuScroll` so only the overlay shows.
 */
export const ModelMenuScroll = memo(function ModelMenuScroll({
  children,
  lockWidth = false,
  className,
  style,
  ...rest
}: ModelMenuScrollProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lockedWidth, setLockedWidth] = useState<number | null>(null);

  // Measure in a ref callback (not an effect) so we stay clear of the
  // repo's `react-hooks/set-state-in-effect` rule. Fires once on mount
  // while the menu is fully expanded.
  const outerRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (!node || !lockWidth) return;
      const width = node.getBoundingClientRect().width;
      if (width > 0) setLockedWidth(width);
    },
    [lockWidth],
  );

  const outerClass = [styles.modelMenu, styles.modelMenuOverlayHost, className]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={outerRef}
      className={outerClass}
      style={lockedWidth != null ? { ...style, minWidth: lockedWidth } : style}
      {...rest}
    >
      <div ref={scrollRef} className={styles.modelMenuScroll}>
        {children}
      </div>
      <OverlayScrollbar scrollRef={scrollRef} />
    </div>
  );
});
