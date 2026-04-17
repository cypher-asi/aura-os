import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChevronRight } from "lucide-react";
import styles from "./Block.module.css";

export type BlockStatus = "pending" | "done" | "error";

export interface BlockProps {
  /** Left-side title text (becomes a mono-styled title). */
  title: ReactNode;
  /** Optional icon rendered before the title. */
  icon?: ReactNode;
  /** Small uppercase badge on the right side of the header (e.g. "EDIT"). */
  badge?: ReactNode;
  /** Optional one-line summary rendered between title and trailing. */
  summary?: ReactNode;
  /** Arbitrary trailing content (status label, exit code, etc.). */
  trailing?: ReactNode;
  /** Drives the status dot color and title weight. */
  status?: BlockStatus;
  /** Whether the body starts expanded. */
  defaultExpanded?: boolean;
  /** When true, force the body open regardless of user toggle state. */
  forceExpanded?: boolean;
  /**
   * When true, pin the body's scroll to the bottom on every content change.
   * Combines with `status === "pending"` for the "tail -f" streaming feel.
   */
  autoScroll?: boolean;
  /** Remove the body's default padding (renderer owns its own layout). */
  flushBody?: boolean;
  /** Body contents. Rendered inside the fixed-height scrolling viewport. */
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
  bodyRef?: RefObject<HTMLDivElement | null>;
}

function statusClass(status: BlockStatus): string {
  switch (status) {
    case "pending": return styles.statusPending;
    case "error": return styles.statusError;
    case "done":
    default: return styles.statusDone;
  }
}

/**
 * Pin an element's scrollTop to scrollHeight whenever `deps` change.
 * Used while a Block is actively streaming so the most recent content
 * stays visible inside the fixed-height body.
 */
function useAutoScrollToBottom(
  ref: RefObject<HTMLElement | null>,
  enabled: boolean,
  deps: unknown[],
) {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
}

export function Block({
  title,
  icon,
  badge,
  summary,
  trailing,
  status = "done",
  defaultExpanded = false,
  forceExpanded = false,
  autoScroll = false,
  flushBody = false,
  children,
  className,
  bodyClassName,
  bodyRef,
}: BlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded || forceExpanded);

  useLayoutEffect(() => {
    if (forceExpanded) setExpanded(true);
  }, [forceExpanded]);

  const toggle = useCallback(() => {
    if (forceExpanded) return;
    setExpanded((v) => !v);
  }, [forceExpanded]);

  const internalBodyRef = useRef<HTMLDivElement | null>(null);
  const mergedBodyRef = useCallback(
    (node: HTMLDivElement | null) => {
      internalBodyRef.current = node;
      if (bodyRef) {
        (bodyRef as { current: HTMLDivElement | null }).current = node;
      }
    },
    [bodyRef],
  );

  useAutoScrollToBottom(internalBodyRef, autoScroll && status === "pending", [
    children,
    expanded,
  ]);

  const bodyVisible = forceExpanded || expanded;

  return (
    <div className={`${styles.block} ${statusClass(status)} ${className ?? ""}`}>
      <button
        type="button"
        className={styles.blockHeader}
        aria-expanded={bodyVisible}
        onClick={toggle}
      >
        <span className={styles.statusDot} />
        {icon ? <span className={styles.blockIcon}>{icon}</span> : null}
        <span className={styles.blockTitle}>
          <span className={styles.blockTitleText}>{title}</span>
        </span>
        {summary ? <span className={styles.blockSummary}>{summary}</span> : null}
        {trailing ? <span className={styles.blockTrailing}>{trailing}</span> : null}
        {badge ? <span className={styles.blockBadge}>{badge}</span> : null}
        <span
          className={`${styles.blockChevron} ${bodyVisible ? styles.blockChevronExpanded : ""}`}
        >
          <ChevronRight size={12} />
        </span>
      </button>
      <div
        className={`${styles.blockBodyWrap} ${bodyVisible ? styles.blockBodyWrapExpanded : ""}`}
        aria-hidden={!bodyVisible}
      >
        <div
          ref={mergedBodyRef}
          className={`${styles.blockBody} ${flushBody ? styles.blockBodyFlush : ""} ${bodyClassName ?? ""}`}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
