import {
  useCallback,
  useLayoutEffect,
  useRef,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import styles from "./SlidingPills.module.css";

/**
 * A single segment in a `SlidingPills` group.
 *
 * `T` is the discriminator (typically a string-literal union) that
 * uniquely identifies this segment. The same `T` is what `value` and
 * `onChange` flow through, so consumers stay strongly typed.
 */
export interface SlidingPillItem<T extends string> {
  /** Stable identifier; emitted via `onChange` when this segment is picked. */
  readonly id: T;
  /** Visible content of the segment button. */
  readonly label: ReactNode;
  /**
   * Accessible label. Falls back to `label` when it is a string; required
   * when `label` is non-string content (icon, decorated node, etc.).
   */
  readonly ariaLabel?: string;
  /** Native `title` tooltip. */
  readonly title?: string;
  /** When true the segment is rendered but cannot be picked / focused. */
  readonly disabled?: boolean;
}

export interface SlidingPillsProps<T extends string> {
  /** Ordered segments. Selection wraps Left/Right at the ends. */
  readonly items: readonly SlidingPillItem<T>[];
  /** Currently selected segment id. The component is controlled. */
  readonly value: T;
  /** Fired when the user picks a different segment. */
  readonly onChange: (next: T) => void;
  /** Fired for every explicit segment pick, including the current segment. */
  readonly onSelect?: (next: T) => void;
  /** Accessible name for the implicit `role="radiogroup"`. */
  readonly ariaLabel: string;
  /** Optional className appended to the root container. */
  readonly className?: string;
  /** Optional className appended to every segment button. */
  readonly segmentClassName?: string;
  /** Optional className appended to the sliding indicator pill. */
  readonly indicatorClassName?: string;
  /**
   * Optional `data-testid` attribute applied to the sliding indicator
   * span so tests can capture the same DOM node before and after a
   * selection change.
   */
  readonly indicatorTestId?: string;
}

const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

/**
 * Generic segmented control with a single sliding indicator pill.
 *
 * Implementation note: the indicator's `transform`, `width` and
 * `height` are written **imperatively** in a layout effect (via the
 * indicator ref) rather than through React state. Holding the rect in
 * `useState` caused two commits per click — once with the old rect,
 * once with the new rect — both before the browser paints. Chromium
 * can collapse those into a single style-change cycle so the
 * `transform` delta never triggers the CSS transition and the pill
 * snaps. Writing straight to the DOM here keeps a single style write
 * per click and lets the browser see a clean previous → next
 * transform between paints, which is what fires the slide.
 *
 * Slide is suppressed for any apply that is NOT a user-driven `value`
 * change: the initial mount (where the CSS default `translate(0, 0)`
 * would otherwise visibly slide into the active segment) and every
 * `ResizeObserver` callback (host-driven layout shifts like the chat
 * panel's centered → bottom reveal, sidekick resize, scrollbar
 * appearing, font swap). Those write `transition: none`, set the
 * geometry, force a reflow to commit, then restore the CSS-cascaded
 * transition so the next user click still slides. This is what fixes
 * the "pill jitters for a split moment when switching apps" bug:
 * remounting `ModeSelector` no longer slides the indicator into place,
 * and post-mount layout settling no longer re-triggers a slide.
 */
export function SlidingPills<T extends string>({
  items,
  value,
  onChange,
  onSelect,
  ariaLabel,
  className,
  segmentClassName,
  indicatorClassName,
  indicatorTestId,
}: SlidingPillsProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef(new Map<T, HTMLButtonElement | null>());
  // Tracks the `value` that the indicator was last positioned for. A
  // null sentinel means "nothing has been applied yet" (i.e. initial
  // mount); a stored value that matches the incoming `value` means
  // the re-run was driven by `items.length` or a ResizeObserver
  // callback rather than a user changing modes — neither should
  // animate.
  const lastAppliedValueRef = useRef<T | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    const selectedEl = itemRefs.current.get(value);
    if (!container || !indicator || !selectedEl) return;

    const apply = (animate: boolean) => {
      if (!animate) {
        indicator.style.transition = "none";
      }
      const containerRect = container.getBoundingClientRect();
      const selectedRect = selectedEl.getBoundingClientRect();
      // `getBoundingClientRect` measures from the container's border
      // box, but the absolutely-positioned indicator (`top/left: 0`) is
      // offset from the padding box (inside the border). Subtract the
      // border widths (`clientLeft`/`clientTop`) so a bordered container
      // doesn't shift the indicator down / right by the border width.
      // Borderless consumers read 0 here.
      indicator.style.transform = `translate(${
        selectedRect.left - containerRect.left - container.clientLeft
      }px, ${selectedRect.top - containerRect.top - container.clientTop}px)`;
      indicator.style.width = `${selectedRect.width}px`;
      indicator.style.height = `${selectedRect.height}px`;
      indicator.style.opacity = "1";
      if (!animate) {
        // Force a style flush so the `transition: none` write is
        // committed against the new geometry before we restore the
        // CSS-cascaded transition; otherwise the browser can collapse
        // both writes into a single change and animate the delta.
        // `offsetWidth` is a layout-forcing property read (no function
        // call), so it avoids re-entering any `getBoundingClientRect`
        // spy that tests may have installed on `Element.prototype`.
        void indicator.offsetWidth;
        indicator.style.transition = "";
      }
    };

    const isUserDriven =
      lastAppliedValueRef.current !== null &&
      lastAppliedValueRef.current !== value;
    apply(isUserDriven);
    lastAppliedValueRef.current = value;

    // ResizeObserver fires its callback once immediately on
    // `.observe()`. Skip that first invocation so it doesn't
    // overwrite an in-progress slide animation with `transition:none`.
    let firstCallback = true;
    const observer = new ResizeObserver(() => {
      if (firstCallback) {
        firstCallback = false;
        return;
      }
      apply(false);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [value, items.length]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (!NAVIGATION_KEYS.has(event.key)) return;
      const enabled = items.filter((item) => !item.disabled);
      if (enabled.length === 0) return;
      const idx = enabled.findIndex((item) => item.id === value);
      if (idx < 0) return;
      event.preventDefault();
      const last = enabled.length - 1;
      let nextIdx = idx;
      if (event.key === "ArrowLeft") nextIdx = idx === 0 ? last : idx - 1;
      else if (event.key === "ArrowRight") nextIdx = idx === last ? 0 : idx + 1;
      else if (event.key === "Home") nextIdx = 0;
      else if (event.key === "End") nextIdx = last;
      const nextId = enabled[nextIdx].id;
      if (nextId === value) return;
      onSelect?.(nextId);
      onChange(nextId);
      requestAnimationFrame(() => {
        itemRefs.current.get(nextId)?.focus();
      });
    },
    [items, onChange, onSelect, value],
  );

  const rootClassName = [styles.root, className].filter(Boolean).join(" ");
  const indicatorClass = [styles.indicator, indicatorClassName]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      ref={containerRef}
      className={rootClassName}
      role="radiogroup"
      aria-label={ariaLabel}
      onKeyDown={handleKeyDown}
    >
      <span
        ref={indicatorRef}
        aria-hidden
        className={indicatorClass}
        data-sliding-pills-indicator=""
        data-active-id={value}
        data-testid={indicatorTestId}
      />
      {items.map((item) => {
        const isSelected = item.id === value;
        const accessibleLabel =
          item.ariaLabel ??
          (typeof item.label === "string" ? item.label : undefined);
        const segmentClass = [
          styles.segment,
          isSelected ? styles.segmentSelected : null,
          segmentClassName,
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={item.id}
            ref={(node) => {
              itemRefs.current.set(item.id, node);
            }}
            type="button"
            role="radio"
            aria-checked={isSelected}
            aria-label={accessibleLabel}
            title={item.title}
            disabled={item.disabled}
            tabIndex={isSelected ? 0 : -1}
            data-sliding-pills-item={item.id}
            className={segmentClass}
            onMouseDown={(e) => {
              // Keep focus on whatever element the user was editing
              // (e.g. the textarea below the mode bar). Buttons grab
              // focus on mousedown by default, which would defocus the
              // input. We still receive the subsequent click, so
              // selection and onChange behave normally.
              e.preventDefault();
            }}
            onClick={() => {
              if (item.disabled) return;
              onSelect?.(item.id);
              if (!isSelected) onChange(item.id);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
