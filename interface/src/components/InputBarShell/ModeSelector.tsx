import {
  memo,
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  AGENT_MODE_DESCRIPTORS,
  AGENT_MODE_ORDER,
  type AgentMode,
} from "../../constants/modes";
import styles from "./ModeSelector.module.css";

export interface ModeSelectorProps {
  selectedMode: AgentMode;
  onChange: (mode: AgentMode) => void;
  /** Optional className appended to the root for layout overrides. */
  className?: string;
  /** Hide the leading "MODE" label (e.g. on very narrow surfaces). */
  hideLabel?: boolean;
}

/**
 * Segmented control rendered as the topmost section of the agent
 * chat input. Exactly one mode is active at a time; selection is
 * keyboard-navigable (Left/Right arrows) and announced as a radio
 * group to assistive tech.
 *
 * The indicator pill is positioned by measuring the active
 * button's pixel offset and width via the DOM, then applying
 * concrete px-based `transform` and `width` inline styles. A CSS
 * transition on both properties produces the sliding animation.
 * A ResizeObserver re-measures on layout shifts so the pill stays
 * aligned after responsive changes.
 */
export const ModeSelector = memo(function ModeSelector({
  selectedMode,
  onChange,
  className,
  hideLabel = false,
}: ModeSelectorProps) {
  const buttonRefs = useRef<Record<AgentMode, HTMLButtonElement | null>>({
    code: null,
    plan: null,
    image: null,
    "3d": null,
  });
  const segmentsRef = useRef<HTMLDivElement>(null);

  const [pill, setPill] = useState<{ left: number; width: number } | null>(null);
  const readyRef = useRef(false);

  useLayoutEffect(() => {
    const btn = buttonRefs.current[selectedMode];
    const container = segmentsRef.current;
    if (!btn || !container) return;

    const containerRect = container.getBoundingClientRect();
    const btnRect = btn.getBoundingClientRect();
    const left = btnRect.left - containerRect.left;
    const width = btnRect.width;
    setPill({ left, width });

    if (!readyRef.current) {
      requestAnimationFrame(() => {
        readyRef.current = true;
      });
    }

    const ro = new ResizeObserver(() => {
      const b = buttonRefs.current[selectedMode];
      const c = segmentsRef.current;
      if (!b || !c) return;
      const cRect = c.getBoundingClientRect();
      const bRect = b.getBoundingClientRect();
      setPill({ left: bRect.left - cRect.left, width: bRect.width });
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [selectedMode]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const key = event.key;
      if (key !== "ArrowLeft" && key !== "ArrowRight" && key !== "Home" && key !== "End") {
        return;
      }
      event.preventDefault();
      const idx = AGENT_MODE_ORDER.indexOf(selectedMode);
      if (idx < 0) return;
      let nextIdx = idx;
      if (key === "ArrowLeft") nextIdx = (idx - 1 + AGENT_MODE_ORDER.length) % AGENT_MODE_ORDER.length;
      else if (key === "ArrowRight") nextIdx = (idx + 1) % AGENT_MODE_ORDER.length;
      else if (key === "Home") nextIdx = 0;
      else if (key === "End") nextIdx = AGENT_MODE_ORDER.length - 1;
      const nextMode = AGENT_MODE_ORDER[nextIdx];
      onChange(nextMode);
      requestAnimationFrame(() => buttonRefs.current[nextMode]?.focus());
    },
    [onChange, selectedMode],
  );

  const rootClass = [styles.root, className].filter(Boolean).join(" ");
  const indicatorStyle: CSSProperties = pill
    ? { transform: `translateX(${pill.left}px)`, width: `${pill.width}px` }
    : { opacity: 0 };
  const indicatorClass = `${styles.indicator}${readyRef.current ? ` ${styles.indicatorReady}` : ""}`;

  return (
    <div
      className={rootClass}
      role="radiogroup"
      aria-label="Agent mode"
      data-agent-surface="mode-selector"
      data-agent-mode={selectedMode}
      onKeyDown={handleKeyDown}
    >
      {hideLabel ? null : <span className={styles.label}>MODE</span>}
      <div className={styles.segments} ref={segmentsRef}>
        <span
          aria-hidden
          className={indicatorClass}
          data-agent-element="mode-indicator"
          style={indicatorStyle}
        />
        {AGENT_MODE_ORDER.map((mode) => {
          const descriptor = AGENT_MODE_DESCRIPTORS[mode];
          const isActive = mode === selectedMode;
          return (
            <button
              key={mode}
              ref={(node) => {
                buttonRefs.current[mode] = node;
              }}
              type="button"
              role="radio"
              aria-checked={isActive}
              aria-label={`${descriptor.label} mode`}
              title={descriptor.description}
              tabIndex={isActive ? 0 : -1}
              data-agent-mode-option={mode}
              className={`${styles.segment}${isActive ? ` ${styles.segmentActive}` : ""}`}
              onClick={() => {
                if (!isActive) onChange(mode);
              }}
            >
              {descriptor.label}
            </button>
          );
        })}
      </div>
    </div>
  );
});
