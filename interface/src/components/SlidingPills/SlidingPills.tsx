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
  /** Accessible name for the implicit `role="radiogroup"`. */
  readonly ariaLabel: string;
  /** Optional className appended to the root container. */
  readonly className?: string;
  /** Optional className appended to every segment button. */
  readonly segmentClassName?: string;
  /** Optional className appended to the sliding indicator pill. */
  readonly indicatorClassName?: string;
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
 */
export function SlidingPills<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className,
  segmentClassName,
  indicatorClassName,
}: SlidingPillsProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const indicatorRef = useRef<HTMLSpanElement>(null);
  const itemRefs = useRef(new Map<T, HTMLButtonElement | null>());

  useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    const selectedEl = itemRefs.current.get(value);
    if (!container || !indicator || !selectedEl) return;

    const apply = () => {
      const containerRect = container.getBoundingClientRect();
      const selectedRect = selectedEl.getBoundingClientRect();
      indicator.style.transform = `translate(${
        selectedRect.left - containerRect.left
      }px, ${selectedRect.top - containerRect.top}px)`;
      indicator.style.width = `${selectedRect.width}px`;
      indicator.style.height = `${selectedRect.height}px`;
      indicator.style.opacity = "1";
    };
    apply();

    const observer = new ResizeObserver(apply);
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
      onChange(nextId);
      requestAnimationFrame(() => {
        itemRefs.current.get(nextId)?.focus();
      });
    },
    [items, onChange, value],
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
            onClick={() => {
              if (!isSelected && !item.disabled) onChange(item.id);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
