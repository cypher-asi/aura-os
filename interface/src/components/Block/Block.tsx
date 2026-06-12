import {
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { ChevronRight } from "lucide-react";
import { CopyButton } from "../CopyButton";
import styles from "./Block.module.css";

/**
 * `attention` marks a soft failure the agent absorbed and continued past
 * (e.g. a probing command that exited non-zero). It renders calm — amber
 * dot, default title color — while `error` (red) is reserved for hard,
 * terminal failures such as retry exhaustion.
 */
export type BlockStatus = "pending" | "done" | "attention" | "error";

/**
 * Lazily-evaluated payload for the always-on copy icon every Block
 * renders in its header. Renderers must supply this so the right edge
 * of every block looks identical; pending / empty blocks should fall
 * back to a string derived from the title so the icon still has
 * something useful to copy.
 */
export interface BlockCopy {
  getText?: () => string;
  getMarkdown?: () => string;
  ariaLabel?: string;
}

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
  /**
   * Always-on icon-only copy button rendered just before the chevron.
   * Required so every block has the same right-edge anatomy and so
   * each renderer is forced to decide what copy means for it.
   */
  copy: BlockCopy;
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
  /**
   * Render only the header — no chevron, no body wrap, no expand/collapse
   * affordance. Used by renderers (e.g. `ThinkingBlock` while a segment is
   * streaming with no text yet) where the header alone is the entire UI:
   * a non-interactive row that shimmers while the model works. Skips
   * mounting `children` entirely so an empty body cannot paint a stray
   * `border-top` between the header and the block's bottom edge.
   */
  headerOnly?: boolean;
}

function statusClass(status: BlockStatus): string {
  switch (status) {
    case "pending": return styles.statusPending;
    case "attention": return styles.statusAttention;
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
  copy,
  status = "done",
  defaultExpanded = false,
  forceExpanded = false,
  autoScroll = false,
  flushBody = false,
  children,
  className,
  bodyClassName,
  bodyRef,
  headerOnly = false,
}: BlockProps) {
  const [expanded, setExpanded] = useState(defaultExpanded || forceExpanded);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const revealTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (revealTimeoutRef.current != null) {
        window.clearTimeout(revealTimeoutRef.current);
      }
    };
  }, []);

  // After a user-initiated expand, nudge the scroll container so the
  // newly revealed body is actually readable instead of opening below
  // the fold. Deferred past the 160ms grid-rows expand animation so the
  // measured height is final; `block: "nearest"` scrolls the minimum
  // distance (no jump when the block is already fully visible).
  const revealAfterExpand = useCallback(() => {
    if (revealTimeoutRef.current != null) {
      window.clearTimeout(revealTimeoutRef.current);
    }
    revealTimeoutRef.current = window.setTimeout(() => {
      revealTimeoutRef.current = null;
      rootRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }, 190);
  }, []);

  // Auto-collapse on the `forceExpanded` true -> false edge so e.g. a
  // pending command block that just resolved snaps back to its default
  // (collapsed) state instead of staying open from the streaming-era
  // forced-expand. The ref-guard means a steady-state change to
  // `defaultExpanded` while `forceExpanded` is already false (e.g. the
  // finalize-handoff that flips `defaultActivitiesExpanded` to `true` on
  // the just-finished message) does NOT clobber a user's manual toggle
  // on blocks that were never force-expanded. While `forceExpanded` is
  // `true` the toggle is suppressed (`aria-disabled` + `toggle`
  // returning early), so the user cannot have set a preference we'd
  // overwrite on the falling edge.
  const prevForceExpandedRef = useRef(forceExpanded);
  useLayoutEffect(() => {
    if (forceExpanded) {
      setExpanded(true);
    } else if (prevForceExpandedRef.current) {
      setExpanded(defaultExpanded);
    }
    prevForceExpandedRef.current = forceExpanded;
  }, [forceExpanded, defaultExpanded]);

  const toggle = useCallback(() => {
    if (forceExpanded) return;
    setExpanded((v) => {
      const next = !v;
      if (next) revealAfterExpand();
      return next;
    });
  }, [forceExpanded, revealAfterExpand]);

  // The header used to be rendered as `<button>`, but renderers like
  // `SpecBlock` thread interactive controls (e.g. a `CopyButton`) through
  // the `trailing` slot — nesting a `<button>` inside another `<button>`
  // is invalid HTML and triggers a React hydration warning. We instead
  // use a `<div>` with `role="button"` plus keyboard handling so the
  // trailing slot can safely host other buttons.
  const handleHeaderKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (forceExpanded) return;
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        toggle();
      }
    },
    [forceExpanded, toggle],
  );

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

  const headerInteractiveProps = headerOnly
    ? {}
    : {
        role: "button" as const,
        tabIndex: forceExpanded ? -1 : 0,
        "aria-expanded": bodyVisible,
        "aria-disabled": forceExpanded || undefined,
        onClick: toggle,
        onKeyDown: handleHeaderKeyDown,
      };

  return (
    <div
      ref={rootRef}
      className={`${styles.block} ${statusClass(status)} ${className ?? ""}`}
    >
      <div
        className={`${styles.blockHeader} ${headerOnly ? styles.blockHeaderStatic : ""}`}
        {...headerInteractiveProps}
      >
        <span className={styles.statusDot} />
        {icon ? <span className={styles.blockIcon}>{icon}</span> : null}
        <span className={styles.blockTitle}>
          <span className={styles.blockTitleText}>{title}</span>
        </span>
        {summary ? (
          <span className={styles.blockSummary}>{summary}</span>
        ) : (
          <span className={styles.blockSpacer} aria-hidden="true" />
        )}
        {trailing ? <span className={styles.blockTrailing}>{trailing}</span> : null}
        {badge ? <span className={styles.blockBadge}>{badge}</span> : null}
        <span className={styles.blockCopy}>
          <CopyButton
            getText={copy.getText}
            getMarkdown={copy.getMarkdown}
            ariaLabel={copy.ariaLabel ?? "Copy"}
            iconOnly
          />
        </span>
        {headerOnly ? null : (
          <span
            className={`${styles.blockChevron} ${bodyVisible ? styles.blockChevronExpanded : ""}`}
          >
            <ChevronRight size={12} />
          </span>
        )}
      </div>
      {headerOnly ? null : (
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
      )}
    </div>
  );
}
