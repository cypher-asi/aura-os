import { useRef, useState, useEffect, useLayoutEffect, useCallback, type ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Tabs.module.css';

export interface Tab {
  id: string;
  label: string;
  icon?: ReactNode;
}

export interface TabsProps {
  /** Array of tab definitions */
  tabs: Tab[];
  /** The currently active tab id */
  value?: string;
  /** Callback when the active tab changes */
  onChange?: (id: string) => void;
  /**
   * @deprecated Use `value` instead
   */
  activeTab?: string;
  /**
   * @deprecated Use `onChange` instead
   */
  onTabChange?: (id: string) => void;
  /** Additional CSS class for the tabs container */
  className?: string;
  /** Additional CSS class for individual tab buttons */
  tabClassName?: string;
  /** Size variant */
  size?: 'xs' | 'sm' | 'md';
}

export function Tabs({
  tabs,
  value,
  onChange,
  activeTab,
  onTabChange,
  className,
  tabClassName,
  size = 'sm',
}: TabsProps) {
  // Support both old and new prop names (old names are deprecated)
  const currentValue = value ?? activeTab ?? '';
  const handleChange = onChange ?? onTabChange;

  const containerRef = useRef<HTMLDivElement>(null);
  const tabRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [indicatorStyle, setIndicatorStyle] = useState({ left: 0, width: 0 });
  const [isInitialized, setIsInitialized] = useState(false);

  const updateIndicator = useCallback(() => {
    const activeButton = tabRefs.current.get(currentValue);
    const container = containerRef.current;

    if (activeButton && container) {
      const containerRect = container.getBoundingClientRect();
      const buttonRect = activeButton.getBoundingClientRect();

      setIndicatorStyle({
        left: buttonRect.left - containerRect.left,
        width: buttonRect.width,
      });

      // Enable transitions after first render
      if (!isInitialized) {
        requestAnimationFrame(() => setIsInitialized(true));
      }
    }
  }, [currentValue, isInitialized]);

  // Use useLayoutEffect for initial measurement to prevent flash
  useLayoutEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  // Also update on resize
  useEffect(() => {
    const handleResize = () => updateIndicator();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [updateIndicator]);

  return (
    <div className={clsx(styles.tabs, className)}>
      <div ref={containerRef} className={styles.tabList}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) {
                tabRefs.current.set(tab.id, el);
              } else {
                tabRefs.current.delete(tab.id);
              }
            }}
            onClick={() => handleChange?.(tab.id)}
            className={clsx(
              styles.tab,
              size === 'xs' && styles.tabXs,
              size === 'md' && styles.tabMd,
              currentValue === tab.id && styles.active,
              tabClassName
            )}
          >
            {tab.icon && <span className={styles.tabIcon}>{tab.icon}</span>}
            {tab.label}
          </button>
        ))}
        <div
          className={clsx(styles.indicator, isInitialized && styles.indicatorAnimated)}
          style={{
            transform: `translateX(${indicatorStyle.left}px)`,
            width: indicatorStyle.width,
          }}
        />
      </div>
    </div>
  );
}
