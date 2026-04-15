import {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { cn, useResize } from "@cypher-asi/zui";
import styles from "./Lane.module.css";

export interface LaneResizeControls {
  getSize: () => number;
  setSize: (size: number) => void;
}

export interface LaneProps {
  children?: ReactNode;
  header?: ReactNode;
  taskbar?: ReactNode;
  /** Renders below the taskbar (e.g. terminal panel in agent chat). */
  footer?: ReactNode;

  /** Enable horizontal resize. */
  resizable?: boolean;
  /** Which edge the resize handle sits on. */
  resizePosition?: "left" | "right";
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  storageKey?: string | null;
  onResizeStart?: () => void;
  onResize?: (size: number) => void;
  onResizeEnd?: (size: number) => void;

  /** Take remaining horizontal space instead of a fixed width. */
  flex?: boolean;

  /**
   * When true the lane can collapse to zero width.
   * The inner content keeps its open width so it clips rather than squishes.
   */
  collapsible?: boolean;

  /** Animate width to 0. Content stays in the DOM. */
  collapsed?: boolean;
  /** When false, collapse/expand snaps instead of tweening width. */
  animateCollapse?: boolean;
  /** When false, width updates snap instead of easing after resize ends. */
  animateResizeRelease?: boolean;
  resizeControlsRef?: MutableRefObject<LaneResizeControls | null>;

  className?: string;
  style?: CSSProperties;
}

export const Lane = forwardRef<HTMLDivElement, LaneProps>(
  (
    {
      children,
      header,
      taskbar,
      footer,
      resizable = false,
      resizePosition = "right",
      defaultWidth = 240,
      minWidth = 0,
      maxWidth = 400,
      storageKey,
      onResizeStart,
      onResize,
      onResizeEnd,
      flex = false,
      collapsible = false,
      collapsed = false,
      animateCollapse = true,
      animateResizeRelease = true,
      resizeControlsRef,
      className,
      style,
    },
    ref,
  ) => {
    const laneRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => laneRef.current as HTMLDivElement);

    const panelSide = resizePosition === "right" ? "left" : "right";
    const resolvedStorageKey =
      storageKey === null ? undefined : (storageKey ?? "lane-width");

    const { size: width, isResizing, handleMouseDown, setSize } = useResize({
      side: panelSide,
      minSize: minWidth,
      maxSize: maxWidth,
      defaultSize: defaultWidth,
      storageKey: resolvedStorageKey,
      elementRef: laneRef,
      enabled: resizable,
      onResizeStart,
      onResize,
      onResizeEnd,
    });

    const openWidth = resizable ? width : defaultWidth;
    const resolvedWidth = collapsed ? 0 : openWidth;
    const previousCollapsedRef = useRef(collapsed);
    const isCollapseToggling = previousCollapsedRef.current !== collapsed;

    useLayoutEffect(() => {
      previousCollapsedRef.current = collapsed;
    }, [collapsed]);

    useLayoutEffect(() => {
      if (!resizeControlsRef) return;
      resizeControlsRef.current = {
        getSize: () => openWidth,
        setSize,
      };
      return () => {
        resizeControlsRef.current = null;
      };
    }, [openWidth, resizeControlsRef, setSize]);

    const laneStyle: CSSProperties = {
      ...style,
      ...(flex
        ? {}
        : {
            width: resolvedWidth,
            ...(collapsed && { minWidth: 0 }),
            transition:
              isResizing
                || (!animateCollapse && isCollapseToggling)
                || (!isCollapseToggling && !animateResizeRelease)
                ? "none"
                : "width 100ms ease-out",
          }),
    };

    return (
      <div
        ref={laneRef}
        data-lane
        data-resizing={isResizing || undefined}
        className={cn(
          styles.lane,
          flex && styles.laneFlex,
          isResizing && styles.resizing,
          collapsed && styles.collapsed,
          !animateCollapse && styles.noCollapseAnimation,
          className,
        )}
        style={laneStyle}
      >
        {resizable && (
          <div
            data-resize-handle
            data-lane-resize-handle
            className={cn(
              styles.resizeHandle,
              resizePosition === "left" ? styles.resizeHandleLeft : styles.resizeHandleRight,
            )}
            onMouseDown={handleMouseDown}
          />
        )}

        <div className={styles.laneInner} style={collapsible ? { minWidth: openWidth } : undefined}>
          {header && <div className={styles.laneHeader}>{header}</div>}
          <div className={styles.laneContent}>{children}</div>
          {taskbar && <div className={styles.laneTaskbar}>{taskbar}</div>}
          {footer && <div className={styles.laneFooter}>{footer}</div>}
        </div>
      </div>
    );
  },
);

Lane.displayName = "Lane";
