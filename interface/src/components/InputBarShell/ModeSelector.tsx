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
 * Width of the gap between segments in the CSS grid; must stay in
 * sync with `--mode-gap` in the module CSS so the JS-emitted
 * transform lines the pill up exactly with the active button.
 */
const MODE_GAP_PX = 2;

/**
 * Segmented control rendered as the topmost section of the agent
 * chat input. Exactly one mode is active at a time; selection is
 * keyboard-navigable (Left/Right/Home/End) and announced as a radio
 * group to assistive tech.
 *
 * The sliding pill is positioned without any DOM measurement: the
 * segments grid uses equal 1fr columns, the indicator's width is
 * one column wide via CSS calc, and React emits a literal
 * `transform: translateX(calc(N * 100% + N * gap))` per render —
 * `100%` on `translateX` is relative to the indicator's own width
 * (i.e. one column), so each index step is exactly one column plus
 * one gap. Emitting the resolved transform string (rather than
 * routing through a CSS variable) ensures the transform's computed
 * value differs across renders, which is what the CSS transition
 * needs to actually interpolate between the two positions.
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
  const safeIndex = activeIndex < 0 ? 0 : activeIndex;
  const indicatorStyle: CSSProperties = {
    transform:
      safeIndex === 0
        ? "translateX(0)"
        : `translateX(calc(${safeIndex} * 100% + ${safeIndex * MODE_GAP_PX}px))`,
  };

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
