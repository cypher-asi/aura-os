import type { KeyboardEvent, ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import styles from "./FolderSection.module.css";

export interface FolderSectionProps {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children: ReactNode;
  /** Optional right-aligned suffix (e.g. action buttons). */
  suffix?: ReactNode;
  /** Nesting level for left-indent. */
  depth?: number;
  /** Optional stable id for the toggle button (useful for aria-controls). */
  id?: string;
  className?: string;
}

export function FolderSection({
  label,
  expanded,
  onToggle,
  children,
  suffix,
  depth = 0,
  id,
  className,
}: FolderSectionProps) {
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowRight" && !expanded) {
      event.preventDefault();
      onToggle();
      return;
    }
    if (event.key === "ArrowLeft" && expanded) {
      event.preventDefault();
      onToggle();
    }
  };

  const headerClassName = [styles.sectionHeader, className].filter(Boolean).join(" ");

  return (
    <section className={styles.sectionGroup}>
      <div className={headerClassName} style={{ paddingLeft: 16 + depth * 16 }}>
        <button
          id={id}
          type="button"
          className={styles.sectionMainButton}
          aria-expanded={expanded}
          onClick={onToggle}
          onKeyDown={handleKeyDown}
        >
          <span className={styles.sectionLabel}>{label}</span>
          <span className={styles.sectionChevronWrap} aria-hidden="true">
            <ChevronRight
              size={14}
              className={`${styles.sectionChevron} ${expanded ? styles.sectionChevronExpanded : ""}`}
            />
          </span>
        </button>
        {suffix ? <span className={styles.sectionActions}>{suffix}</span> : null}
      </div>
      {expanded ? (
        <div className={styles.childrenList} role="group">
          {children}
        </div>
      ) : null}
    </section>
  );
}
