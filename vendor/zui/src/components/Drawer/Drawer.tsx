import { useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { ButtonCollapsible, type ButtonCollapsibleDirection } from '../Button';
import { useResize, type ResizeSide } from '../../lib/useResize';
import styles from './Drawer.module.css';

export type DrawerSide = 'left' | 'right' | 'top' | 'bottom';

export interface DrawerProps {
  /** Which side of the screen the drawer appears from */
  side: DrawerSide;
  
  /** Whether the drawer is open */
  isOpen: boolean;
  
  /** Callback when the drawer should close */
  onClose: () => void;
  
  /** Callback when the drawer should open (required if showToggle is true) */
  onOpen?: () => void;
  
  /** The content to render inside the drawer */
  children: ReactNode;
  
  /** Optional title displayed in a header bar */
  title?: string;
  
  /** Minimum size (width for left/right, height for top/bottom) in pixels */
  minSize?: number;
  
  /** Maximum size (width for left/right, height for top/bottom) in pixels */
  maxSize?: number;
  
  /** Default size (width for left/right, height for top/bottom) in pixels */
  defaultSize?: number;
  
  /** Size when minimized in pixels */
  minimizedSize?: number;
  
  /** LocalStorage key for persisting size (optional) */
  storageKey?: string;
  
  /** Whether to start minimized */
  initialMinimized?: boolean;
  
  /** Optional className for additional styling */
  className?: string;
  
  /** Whether to show the minimized bar (only applies to left/right drawers) */
  showMinimizedBar?: boolean;
  
  /** Custom content for minimized bar (overrides default buttons) */
  minimizedBarContent?: ReactNode;
  
  /** Whether to show the always-visible toggle button */
  showToggle?: boolean;
  
  /** Whether to use transparent background */
  transparent?: boolean;
  
  /** Whether to hide the border */
  noBorder?: boolean;
  
  /** Whether clicking the title toggles open/close (default: true) */
  titleClickable?: boolean;
}

function getSavedSize(storageKey: string | undefined, defaultSize: number): number {
  if (!storageKey) return defaultSize;
  
  try {
    const saved = localStorage.getItem(storageKey);
    if (saved) {
      const size = parseInt(saved, 10);
      if (!isNaN(size) && size > 0) {
        return size;
      }
    }
  } catch {
    // localStorage might not be available
  }
  return defaultSize;
}

export function Drawer({
  side,
  isOpen,
  onClose,
  onOpen,
  children,
  title,
  minSize = side === 'left' || side === 'right' ? 320 : 200,
  maxSize = side === 'left' || side === 'right' ? 600 : 800,
  defaultSize = side === 'left' || side === 'right' ? 384 : 300,
  minimizedSize = 40,
  storageKey,
  initialMinimized = false,
  className,
  showMinimizedBar = true,
  minimizedBarContent,
  showToggle = false,
  transparent = false,
  noBorder = false,
  titleClickable = true,
}: DrawerProps) {
  const [currentSize, setCurrentSize] = useState(0); // Always start at 0 for animation
  const [isMinimized, setIsMinimized] = useState(initialMinimized);
  const [hasContent, setHasContent] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  
  const isHorizontal = side === 'left' || side === 'right';
  
  // Map drawer side to resize side (handle is on opposite edge)
  const resizeSide: ResizeSide = side === 'left' ? 'left' : side === 'right' ? 'right' : side === 'top' ? 'top' : 'bottom';
  
  // Calculate offset for toggle panels (toggle strip width)
  const toggleOffset = showToggle && isHorizontal ? 32 : 0;
  
  const { isResizing, handleMouseDown } = useResize({
    side: resizeSide,
    minSize,
    maxSize,
    defaultSize,
    storageKey,
    elementRef: drawerRef,
    offset: toggleOffset,
    enabled: true,
    onResizeStart: () => {
      // If drawer is closed and we start dragging, open it first
      if (!isOpen && onOpen) {
        onOpen();
      }
    },
    onResize: setCurrentSize,
  });
  
  // Animation duration (matches CSS transition)
  const animationDuration = 200;
  
  // Handle open/close transitions with consistent animation
  useEffect(() => {
    if (isResizing) return; // Don't interfere during resize
    
    if (isOpen) {
      // Opening - set content flag, then animate size after a frame
      setHasContent(true);
      const size = getSavedSize(storageKey, defaultSize);
      // Use setTimeout to ensure DOM has painted before animating
      const timer = setTimeout(() => {
        setCurrentSize(size);
      }, 10);
      return () => clearTimeout(timer);
    } else {
      // Closing - animate size to 0, then clear content
      setCurrentSize(0);
      const timer = setTimeout(() => {
        setHasContent(false);
        setIsMinimized(false); // Reset minimized state when closing
      }, animationDuration);
      return () => clearTimeout(timer);
    }
  }, [isOpen, storageKey, defaultSize, isResizing]);
  
  const toggleMinimize = useCallback(() => {
    setIsMinimized((prev) => !prev);
  }, []);
  
  // Get the toggle direction based on side (always points toward open direction)
  const getToggleDirection = (): ButtonCollapsibleDirection => {
    switch (side) {
      case 'left': return 'right';
      case 'right': return 'left';
      case 'top': return 'down';
      case 'bottom': return 'up';
    }
  };
  
  const toggleDirection = getToggleDirection();
  
  const handleToggle = () => {
    if (isOpen) {
      onClose();
    } else if (onOpen) {
      onOpen();
    }
  };
  
  // Calculate display size - use minimized size when minimized
  const displaySize = isMinimized ? minimizedSize : currentSize;
  
  // Get appropriate minimize/expand direction based on side
  const getMinimizeDirection = (): ButtonCollapsibleDirection => {
    if (isMinimized) {
      // When minimized, point toward expand direction (same as toggle)
      return side === 'left' ? 'right' : side === 'right' ? 'left' : side === 'top' ? 'down' : 'up';
    } else {
      // When expanded, point toward minimize direction (opposite of toggle)
      return side === 'left' ? 'left' : side === 'right' ? 'right' : side === 'top' ? 'up' : 'down';
    }
  };
  
  const minimizeDirection = getMinimizeDirection();
  
  // Get resize handle position and cursor
  const getResizeHandleProps = () => {
    switch (side) {
      case 'left':
        return { position: 'right', cursor: 'ew-resize', horizontal: false };
      case 'right':
        return { position: 'left', cursor: 'ew-resize', horizontal: false };
      case 'top':
        return { position: 'bottom', cursor: 'ns-resize', horizontal: true };
      case 'bottom':
        return { position: 'top', cursor: 'ns-resize', horizontal: true };
    }
  };
  
  const resizeHandleProps = getResizeHandleProps();
  
  const drawerClassName = clsx(
    styles.drawer,
    styles[`drawer${side.charAt(0).toUpperCase() + side.slice(1)}`],
    isResizing && styles.drawerResizing,
    isMinimized && styles.drawerMinimized,
    transparent && styles.drawerTransparent,
    noBorder && styles.drawerNoBorder,
    className
  );
  
  const drawerStyle: React.CSSProperties = isHorizontal
    ? { width: displaySize }
    : { height: displaySize };
  
  // For left/right drawers with showToggle - single panel that expands/collapses
  if (showToggle && isHorizontal && onOpen) {
    const toggleWidth = 32;
    // Panel width: when closed just the toggle strip, when open toggle + content
    const panelWidth = toggleWidth + displaySize;
    
    const panelClass = clsx(
      styles.togglePanel,
      styles[`togglePanel${side.charAt(0).toUpperCase() + side.slice(1)}`],
      transparent && styles.togglePanelTransparent,
      noBorder && styles.togglePanelNoBorder,
      isResizing && styles.togglePanelResizing
    );
    
    // Use saved size or default for the inner content width (prevents squishing)
    const contentWidth = getSavedSize(storageKey, defaultSize);
    
    return (
      <div 
        ref={drawerRef}
        className={panelClass} 
        style={{ width: panelWidth }}
      >
        {/* Resize handle - always visible so user can drag to open */}
        <div
          className={clsx(
            styles.resizeHandle,
            side === 'left' ? styles.resizeHandleRight : styles.resizeHandleLeft
          )}
          onMouseDown={handleMouseDown}
        >
          <div className={clsx(styles.resizeHandleLine, styles.resizeHandleLineVertical)} />
        </div>
        
        {/* Inner wrapper with fixed width to prevent content squishing */}
        {/* For right-side drawers, position from the right so chevron stays visible */}
        <div 
          className={clsx(styles.panelInner, side === 'right' && styles.panelInnerRight)}
          style={{ width: toggleWidth + contentWidth }}
        >
          {/* Header - full width, contains chevron and optional title */}
          <div className={clsx(
            styles.panelHeader,
            side === 'right' && styles.panelHeaderRight,
            noBorder && styles.panelHeaderNoBorder
          )}>
            <ButtonCollapsible
              className={styles.panelToggle}
              direction={toggleDirection}
              iconClassName={clsx(styles.toggleIcon, isOpen && styles.toggleIconRotated)}
              onClick={handleToggle}
              title={isOpen ? 'Close' : 'Open'}
            />
            {title && (
              <span 
                className={clsx(
                  styles.panelTitle,
                  displaySize === 0 && styles.panelTitleHidden,
                  titleClickable && !!onOpen && styles.panelTitleClickable
                )}
                onClick={titleClickable && !!onOpen ? handleToggle : undefined}
              >{title}</span>
            )}
          </div>
          
          {/* Content area - full width below header */}
          <div 
            className={clsx(
              styles.panelContent,
              displaySize === 0 && styles.panelContentHidden
            )}
          >
            {children}
          </div>
        </div>
      </div>
    );
  }
  
  // For top/bottom drawers or non-toggle mode, use the original toggle container
  if (currentSize === 0 && !hasContent) {
    if (showToggle && onOpen) {
      return (
        <div className={clsx(
          styles.toggleContainer,
          styles[`toggleContainer${side.charAt(0).toUpperCase() + side.slice(1)}`],
          transparent && styles.toggleContainerTransparent,
          noBorder && styles.toggleContainerNoBorder
        )}>
          <ButtonCollapsible
            className={styles.toggle}
            direction={toggleDirection}
            iconClassName={clsx(styles.toggleIcon, isOpen && styles.toggleIconRotated)}
            onClick={handleToggle}
            title="Open"
          />
        </div>
      );
    }
    return null;
  }
  
  return (
    <div ref={drawerRef} className={drawerClassName} style={drawerStyle}>
      {/* Minimized bar (only for horizontal drawers) */}
      {isMinimized && isHorizontal && showMinimizedBar ? (
        <div className={styles.minimizedBar}>
          {minimizedBarContent || (
            <>
              <ButtonCollapsible
                className={styles.minimizedButton}
                direction={minimizeDirection}
                onClick={toggleMinimize}
                title="Expand"
              />
              <button className={styles.minimizedButton} onClick={onClose} title="Close">
                <X size={16} />
              </button>
            </>
          )}
        </div>
      ) : (
        <>
          {/* Resize handle */}
          {currentSize > 0 && (
            <div
              className={clsx(
                styles.resizeHandle,
                styles[`resizeHandle${resizeHandleProps.position.charAt(0).toUpperCase() + resizeHandleProps.position.slice(1)}`]
              )}
              onMouseDown={handleMouseDown}
            >
              <div
                className={clsx(
                  styles.resizeHandleLine,
                  resizeHandleProps.horizontal ? styles.resizeHandleLineHorizontal : styles.resizeHandleLineVertical
                )}
              />
              {/* Minimize button (only for horizontal drawers with minimizedBar enabled, when showToggle is false) */}
              {!showToggle && isHorizontal && showMinimizedBar && (
                <ButtonCollapsible
                  className={styles.minimizeButton}
                  direction={minimizeDirection}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleMinimize();
                  }}
                  title="Minimize"
                />
              )}
            </div>
          )}
          
          {/* Content - uses fixed inner size to prevent squishing during animation */}
          <div
            className={clsx(styles.drawerInner, currentSize === 0 && styles.drawerInnerHidden)}
            style={isHorizontal 
              ? { minWidth: getSavedSize(storageKey, defaultSize) } 
              : { minHeight: getSavedSize(storageKey, defaultSize) }
            }
          >
            {/* Header with title and toggle */}
            {(title || showToggle) && (
              <div className={styles.drawerHeader}>
                {title && (
                  <span 
                    className={clsx(
                      styles.drawerTitle,
                      titleClickable && !!onOpen && styles.drawerTitleClickable
                    )}
                    onClick={titleClickable && !!onOpen ? handleToggle : undefined}
                  >{title}</span>
                )}
                {showToggle && (
                  <ButtonCollapsible
                    className={styles.headerToggle}
                    direction={toggleDirection}
                    iconClassName={clsx(styles.toggleIcon, isOpen && styles.toggleIconRotated)}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleToggle();
                    }}
                    title={isOpen ? 'Close' : 'Open'}
                  />
                )}
              </div>
            )}
            {children}
          </div>
        </>
      )}
    </div>
  );
}
