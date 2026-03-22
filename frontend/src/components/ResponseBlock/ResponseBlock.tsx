import { useState, useCallback } from "react";
import { ChevronRight } from "lucide-react";
import styles from "./ResponseBlock.module.css";

interface ResponseBlockProps {
  header: React.ReactNode;
  children: React.ReactNode;
  defaultExpanded?: boolean;
  expanded?: boolean;
  onExpandedChange?: (expanded: boolean) => void;
  className?: string;
  contentClassName?: string;
  maxExpandedHeight?: number;
}

export function ResponseBlock({
  header,
  children,
  defaultExpanded = false,
  expanded: controlledExpanded,
  onExpandedChange,
  className,
  contentClassName,
  maxExpandedHeight = 320,
}: ResponseBlockProps) {
  const [internalExpanded, setInternalExpanded] = useState(defaultExpanded);

  const isControlled = controlledExpanded !== undefined;
  const expanded = isControlled ? controlledExpanded : internalExpanded;

  const toggle = useCallback(() => {
    const next = !expanded;
    if (!isControlled) setInternalExpanded(next);
    onExpandedChange?.(next);
  }, [expanded, isControlled, onExpandedChange]);

  return (
    <div className={`${styles.block} ${className ?? ""}`}>
      <button className={styles.header} onClick={toggle} type="button">
        {header}
        <span className={`${styles.chevron} ${expanded ? styles.chevronExpanded : ""}`}>
          <ChevronRight size={14} />
        </span>
      </button>
      <div
        className={`${styles.bodyWrap} ${expanded ? styles.bodyExpanded : ""}`}
        style={expanded ? { maxHeight: maxExpandedHeight } : undefined}
      >
        <div className={`${styles.content} ${contentClassName ?? ""}`}>
          {children}
        </div>
      </div>
    </div>
  );
}
