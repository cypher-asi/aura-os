import { forwardRef, useRef, useImperativeHandle, type ReactNode, type CSSProperties } from "react";
import { cn, useResize } from "@cypher-asi/zui";
import styles from "./Lane.module.css";

export interface LaneProps {
  children?: ReactNode;
  header?: ReactNode;
  taskbar?: ReactNode;

  /** Enable horizontal resize. */
  resizable?: boolean;
  /** Which edge the resize handle sits on. */
  resizePosition?: "left" | "right";
  defaultWidth?: number;
  minWidth?: number;
  maxWidth?: number;
  storageKey?: string;

  /** Take remaining horizontal space instead of a fixed width. */
  flex?: boolean;

  /**
   * When true the lane can collapse to zero width.
   * The inner content keeps its open width so it clips rather than squishes.
   */
  collapsible?: boolean;

  /** Animate width to 0. Content stays in the DOM. */
  collapsed?: boolean;

  className?: string;
  style?: CSSProperties;
}

export const Lane = forwardRef<HTMLDivElement, LaneProps>(
  (
    {
      children,
      header,
      taskbar,
      resizable = false,
      resizePosition = "right",
      defaultWidth = 240,
      minWidth = 200,
      maxWidth = 400,
      storageKey = "lane-width",
      flex = false,
      collapsible = false,
      collapsed = false,
      className,
      style,
    },
    ref,
  ) => {
    const laneRef = useRef<HTMLDivElement>(null);
    useImperativeHandle(ref, () => laneRef.current as HTMLDivElement);

    const panelSide = resizePosition === "right" ? "left" : "right";

    const { size: width, isResizing, handleMouseDown } = useResize({
      side: panelSide,
      minSize: minWidth,
      maxSize: maxWidth,
      defaultSize: defaultWidth,
      storageKey,
      elementRef: laneRef,
      enabled: resizable,
    });

    const openWidth = resizable ? width : defaultWidth;
    const resolvedWidth = collapsed ? 0 : openWidth;

    const laneStyle: CSSProperties = {
      ...style,
      ...(flex
        ? {}
        : {
            width: resolvedWidth,
            ...(collapsed && { minWidth: 0 }),
            transition: isResizing ? "none" : "width 300ms ease-out",
          }),
    };

    return (
      <div
        ref={laneRef}
        className={cn(
          styles.lane,
          flex && styles.laneFlex,
          isResizing && styles.resizing,
          collapsed && styles.collapsed,
          className,
        )}
        style={laneStyle}
      >
        {resizable && (
          <div
            className={cn(
              styles.resizeHandle,
              resizePosition === "left" ? styles.resizeHandleLeft : styles.resizeHandleRight,
            )}
            onMouseDown={handleMouseDown}
          >
            <div className={styles.resizeHandleLine} />
          </div>
        )}

        <div className={styles.laneInner} style={collapsible ? { minWidth: openWidth } : undefined}>
          {header && <div className={styles.laneHeader}>{header}</div>}
          <div className={styles.laneContent}>{children}</div>
          {taskbar && <div className={styles.laneTaskbar}>{taskbar}</div>}
        </div>
      </div>
    );
  },
);

Lane.displayName = "Lane";
