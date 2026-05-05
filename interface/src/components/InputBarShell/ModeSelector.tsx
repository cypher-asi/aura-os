import {
  memo,
  useCallback,
  useRef,
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
 * keyboard-navigable (Left/Right/Home/End) and announced as a radio
 * group to assistive tech.
 *
 * The sliding pill is purely CSS-driven: the segments grid has equal
 * 1fr columns, and the indicator's `transform` is computed from a
 * single `--mode-index` custom property via `calc()`. Changing the
 * active mode just rewrites that property; CSS transitions on
 * `transform` produce the smooth left/right slide. No DOM
 * measurement, layout effects, or ResizeObserver is needed.
 */
export const ModeSelector = memo(function ModeSelector({
  selectedMode,
  onChange,
  className,
  hideLabel = false,
}: ModeSelectorProps) {
  const buttonRefs = useRef(new Map<AgentMode, HTMLButtonElement | null>());

  const activeIndex = AGENT_MODE_ORDER.indexOf(selectedMode);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const key = event.key;
      if (
        key !== "ArrowLeft" &&
        key !== "ArrowRight" &&
        key !== "Home" &&
        key !== "End"
      ) {
        return;
      }
      event.preventDefault();
      const idx = AGENT_MODE_ORDER.indexOf(selectedMode);
      if (idx < 0) return;
      const last = AGENT_MODE_ORDER.length - 1;
      let nextIdx = idx;
      if (key === "ArrowLeft") nextIdx = idx === 0 ? last : idx - 1;
      else if (key === "ArrowRight") nextIdx = idx === last ? 0 : idx + 1;
      else if (key === "Home") nextIdx = 0;
      else if (key === "End") nextIdx = last;
      const nextMode = AGENT_MODE_ORDER[nextIdx];
      onChange(nextMode);
      requestAnimationFrame(() => {
        buttonRefs.current.get(nextMode)?.focus();
      });
    },
    [onChange, selectedMode],
  );

  const rootClass = [styles.root, className].filter(Boolean).join(" ");
  const indicatorStyle = {
    "--mode-index": activeIndex < 0 ? 0 : activeIndex,
  } as CSSProperties;

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
      <div
        className={styles.segments}
        style={
          { "--mode-count": AGENT_MODE_ORDER.length } as CSSProperties
        }
      >
        <span
          aria-hidden
          className={styles.indicator}
          data-agent-element="mode-indicator"
          data-mode={selectedMode}
          data-mode-index={activeIndex}
          style={indicatorStyle}
        />
        {AGENT_MODE_ORDER.map((mode) => {
          const descriptor = AGENT_MODE_DESCRIPTORS[mode];
          const isActive = mode === selectedMode;
          return (
            <button
              key={mode}
              ref={(node) => {
                buttonRefs.current.set(mode, node);
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
