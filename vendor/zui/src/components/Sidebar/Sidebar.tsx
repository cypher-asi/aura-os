import {
  forwardRef,
  useRef,
  useImperativeHandle,
  type ReactNode,
  type CSSProperties,
  type HTMLAttributes,
} from 'react';
import clsx from 'clsx';
import { useResize } from '../../lib/useResize';
import styles from './Sidebar.module.css';

export interface SidebarProps extends Omit<HTMLAttributes<HTMLElement>, 'children'> {
  /** Content to display in the main body of the sidebar */
  children?: ReactNode;
  
  /** Content to display at the top of the sidebar (fixed) */
  header?: ReactNode;
  
  /** Content to display at the bottom of the sidebar (fixed) */
  footer?: ReactNode;
  
  /** 
   * Enable resizing functionality 
   * @default false
   */
  resizable?: boolean;
  
  /** 
   * Minimum width when resizable (in pixels)
   * @default 200
   */
  minWidth?: number;
  
  /** 
   * Maximum width when resizable (in pixels)
   * @default 400
   */
  maxWidth?: number;
  
  /** 
   * Default/initial width (in pixels)
   * @default 240
   */
  defaultWidth?: number;
  
  /** 
   * LocalStorage key for persisting width
   * Only used when resizable is true
   * @default 'sidebar-width'
   */
  storageKey?: string;
  
  /** 
   * Position of the resize handle
   * @default 'right'
   */
  resizePosition?: 'left' | 'right';
  
  /** 
   * Callback when width changes (useful for parent components)
   */
  onWidthChange?: (width: number) => void;

  /**
   * When true, sidebar fills available space (flex: 1) instead of using a fixed width.
   * Useful for main content areas.
   * @default false
   */
  flex?: boolean;
}

export const Sidebar = forwardRef<HTMLElement, SidebarProps>(
  (
    {
      children,
      header,
      footer,
      resizable = false,
      minWidth = 200,
      maxWidth = 400,
      defaultWidth = 240,
      storageKey = 'sidebar-width',
      resizePosition = 'right',
      onWidthChange,
      flex = false,
      className,
      style,
      ...props
    },
    ref
  ) => {
    const sidebarRef = useRef<HTMLElement>(null);

    useImperativeHandle(ref, () => sidebarRef.current as HTMLElement);

    // useResize `side` = which side of the viewport the panel lives on,
    // which is the opposite of where the handle is placed.
    const resizeSide = resizePosition === 'right' ? 'left' : 'right';
    const { size: width, isResizing, handleMouseDown } = useResize({
      side: resizeSide,
      minSize: minWidth,
      maxSize: maxWidth,
      defaultSize: defaultWidth,
      storageKey,
      elementRef: sidebarRef,
      enabled: resizable,
      onResizeEnd: onWidthChange,
    });

    const sidebarStyle: CSSProperties = {
      ...style,
      ...(flex ? {} : resizable ? { width } : { width: defaultWidth }),
    };

    return (
      <aside
        ref={sidebarRef}
        className={clsx(
          styles.sidebar,
          flex && styles.flex,
          resizable && styles.resizable,
          isResizing && styles.resizing,
          className
        )}
        style={sidebarStyle}
        {...props}
      >
        {/* Resize Handle */}
        {resizable && (
          <div
            className={clsx(
              styles.resizeHandle,
              resizePosition === 'left' ? styles.resizeHandleLeft : styles.resizeHandleRight
            )}
            onMouseDown={handleMouseDown}
          >
            <div className={styles.resizeHandleLine} />
          </div>
        )}

        {/* Header Section */}
        {header && <div className={styles.header}>{header}</div>}

        {/* Main Content */}
        <div className={styles.content}>{children}</div>

        {/* Footer Section */}
        {footer && <div className={styles.footer}>{footer}</div>}
      </aside>
    );
  }
);

Sidebar.displayName = 'Sidebar';
