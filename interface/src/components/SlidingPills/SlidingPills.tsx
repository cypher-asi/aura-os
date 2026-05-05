import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
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

interface PillRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

const NAVIGATION_KEYS: ReadonlySet<string> = new Set([
  "ArrowLeft",
  "ArrowRight",
  "Home",
  "End",
]);

/**
 * Generic segmented control with a single sliding indicator pill. The
 * pill measures the active button's rect on every layout-affecting
 * change and animates `transform` / `width` / `height` between
 * positions via plain CSS transitions — no animation library required.
 *
 * The component is controlled (`value` + `onChange`), exposes a
 * `role="radiogroup"` with one `role="radio"` per segment, and
 * supports Left/Right (with wrap-around) and Home/End keyboard
 * navigation. Variable-width segments are handled because the
 * indicator is sized from the measured rect rather than from a fixed
 * column width.
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
  const itemRefs = useRef(new Map<T, HTMLButtonElement | null>());
  const [pillRect, setPillRect] = useState<PillRect | null>(null);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const selectedEl = itemRefs.current.get(value);
    if (!container || !selectedEl) return;

    const measure = () => {
      const containerRect = container.getBoundingClientRect();
      const selectedRect = selectedEl.getBoundingClientRect();
      setPillRect({
        left: selectedRect.left - containerRect.left,
        top: selectedRect.top - containerRect.top,
        width: selectedRect.width,
        height: selectedRect.height,
      });
    };
    measure();

    const observer = new ResizeObserver(measure);
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

  const indicatorStyle: CSSProperties = pillRect
    ? {
        transform: `translate(${pillRect.left}px, ${pillRect.top}px)`,
        width: `${pillRect.width}px`,
        height: `${pillRect.height}px`,
      }
    : { opacity: 0 };

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
        aria-hidden
        className={indicatorClass}
        data-sliding-pills-indicator=""
        data-active-id={value}
        style={indicatorStyle}
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
